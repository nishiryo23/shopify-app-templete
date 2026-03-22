import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { applyShopifyDevAppUrl } from "../scripts/shopify-dev-app-url.mjs";

applyShopifyDevAppUrl();
import { createArtifactStorageFromEnv } from "../domain/artifacts/factory.mjs";
import { createPrismaJobQueue } from "../domain/jobs/prisma-job-queue.mjs";
import { createTelemetry } from "../domain/telemetry/index.mjs";
import {
  addDaysToJstDate,
  buildSystemJobPayload,
  SYSTEM_JOB_KINDS,
  buildSystemRetentionSweepDedupeKeyForDate,
  buildSystemStuckJobSweepDedupeKey,
  parseSystemRetentionSweepWindowDateFromDedupeKey,
  resolveLatestDueSystemRetentionSweepDate,
  SYSTEM_JOB_SHOP_DOMAIN,
  resolveSystemJobMaxAttempts,
  SYSTEM_RETENTION_SWEEP_KIND,
  SYSTEM_STUCK_JOB_SWEEP_KIND,
} from "../domain/system-jobs.mjs";
import { WEBHOOK_SHOP_REDACT_KIND } from "../domain/webhooks/compliance-jobs.mjs";
import { runWebhookShopRedactJob } from "./webhook-compliance.mjs";
import {
  runSystemRetentionSweepJob,
  runSystemStuckJobSweepJob,
} from "./system-sweeps.mjs";
import { TELEMETRY_METRICS } from "../domain/telemetry/emf.mjs";

const ALWAYS_REQUIRED_WORKER_SECRETS = Object.freeze([
  "DATABASE_URL",
  "SHOPIFY_API_SECRET",
  "SHOP_TOKEN_ENCRYPTION_KEY",
]);

const PRODUCTION_ONLY_WORKER_SECRETS = Object.freeze([
  "TELEMETRY_PSEUDONYM_KEY",
]);

const REQUIRED_WORKER_CONFIG = Object.freeze([
  "AWS_REGION",
  "QUEUE_POLL_INTERVAL_MS",
  "QUEUE_LEASE_MS",
  "SHOPIFY_API_KEY",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "S3_ARTIFACT_BUCKET",
  "S3_ARTIFACT_PREFIX",
]);
const SYSTEM_JOB_DEAD_LETTER_RETRY_COOLDOWN_MS = Object.freeze({
  [SYSTEM_RETENTION_SWEEP_KIND]: 30 * 60 * 1000,
  [SYSTEM_STUCK_JOB_SWEEP_KIND]: 5 * 60 * 1000,
});
const PRIORITIZED_SYSTEM_JOB_KINDS = Object.freeze([
  SYSTEM_RETENTION_SWEEP_KIND,
  SYSTEM_STUCK_JOB_SWEEP_KIND,
]);
const ORDINARY_WORKER_JOB_KINDS = Object.freeze([
  WEBHOOK_SHOP_REDACT_KIND,
]);

function parseBase64Secret(encodedSecret, envVarName) {
  const decoded = Buffer.from(encodedSecret, "base64");
  if (decoded.length !== 32) {
    throw new Error(`${envVarName} must decode to 32 bytes`);
  }

  return decoded;
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function validateWorkerEnvironment(env = process.env) {
  const missingConfig = REQUIRED_WORKER_CONFIG.filter((name) => !env[name]);
  if (missingConfig.length > 0) {
    throw new Error(`Missing required worker env vars: ${missingConfig.join(", ")}`);
  }

  const missingAlwaysRequiredSecrets = ALWAYS_REQUIRED_WORKER_SECRETS.filter((name) => !env[name]);
  if (missingAlwaysRequiredSecrets.length > 0) {
    throw new Error(`Missing required worker secrets: ${missingAlwaysRequiredSecrets.join(", ")}`);
  }

  if (env.NODE_ENV === "production") {
    const missingSecrets = PRODUCTION_ONLY_WORKER_SECRETS.filter((name) => !env[name]);
    if (missingSecrets.length > 0) {
      throw new Error(`Missing required worker secrets: ${missingSecrets.join(", ")}`);
    }
  }

  parseBase64Secret(env.SHOP_TOKEN_ENCRYPTION_KEY, "SHOP_TOKEN_ENCRYPTION_KEY");
  if (env.TELEMETRY_PSEUDONYM_KEY) {
    parseBase64Secret(env.TELEMETRY_PSEUDONYM_KEY, "TELEMETRY_PSEUDONYM_KEY");
  }

  const queueLeaseMs = parsePositiveInt(env.QUEUE_LEASE_MS, "QUEUE_LEASE_MS");
  buildHeartbeatInterval(queueLeaseMs);

  return {
    artifactPrefix: env.S3_ARTIFACT_PREFIX,
    awsRegion: env.AWS_REGION,
    logLevel: env.LOG_LEVEL || "info",
    pollIntervalMs: parsePositiveInt(env.QUEUE_POLL_INTERVAL_MS, "QUEUE_POLL_INTERVAL_MS"),
    queueLeaseMs,
  };
}

export function buildWorkerId() {
  return `worker:${process.pid}:${crypto.randomUUID()}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildHeartbeatInterval(leaseMs) {
  if (leaseMs <= 1) {
    throw new Error("QUEUE_LEASE_MS must be greater than 1");
  }

  return Math.max(1, Math.min(1000, leaseMs - 1, Math.floor(leaseMs / 3)));
}

function createDeferredSignal() {
  let settled = false;
  let resolveSignal = () => {};
  const promise = new Promise((resolve) => {
    resolveSignal = (value) => {
      settled = true;
      resolve(value);
    };
  });

  return {
    isResolved() {
      return settled;
    },
    promise,
    resolve: resolveSignal,
  };
}

function buildScheduledStuckJobSweep(now = new Date()) {
  return {
    dedupeKey: buildSystemStuckJobSweepDedupeKey(now),
    kind: SYSTEM_STUCK_JOB_SWEEP_KIND,
    maxAttempts: resolveSystemJobMaxAttempts(SYSTEM_STUCK_JOB_SWEEP_KIND),
    payload: buildSystemJobPayload({
      dedupeKey: buildSystemStuckJobSweepDedupeKey(now),
      requestedAt: now,
      windowStart: buildSystemStuckJobSweepDedupeKey(now).slice("system:stuck-job-sweep:".length),
    }),
  };
}

function buildScheduledRetentionSweep(windowDate, now = new Date()) {
  const dedupeKey = buildSystemRetentionSweepDedupeKeyForDate(windowDate);

  return {
    dedupeKey,
    kind: SYSTEM_RETENTION_SWEEP_KIND,
    maxAttempts: resolveSystemJobMaxAttempts(SYSTEM_RETENTION_SWEEP_KIND),
    payload: buildSystemJobPayload({
      dedupeKey,
      requestedAt: now,
      scheduledAt: new Date(`${windowDate}T03:00:00+09:00`),
      timeZone: "Asia/Tokyo",
      windowDate,
    }),
  };
}

function compareIsoDateStrings(left, right) {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function buildLatestRetentionJobsByWindow(retentionJobs = []) {
  const latestRetentionJobsByWindow = new Map();

  for (const job of retentionJobs) {
    const windowDate = parseSystemRetentionSweepWindowDateFromDedupeKey(job?.dedupeKey ?? null);

    if (!windowDate || latestRetentionJobsByWindow.has(windowDate)) {
      continue;
    }

    latestRetentionJobsByWindow.set(windowDate, job);
  }

  return latestRetentionJobsByWindow;
}

async function buildScheduledSystemJobs({
  jobQueue,
  now = new Date(),
} = {}) {
  const scheduledJobs = [buildScheduledStuckJobSweep(now)];
  const latestDueWindowDate = resolveLatestDueSystemRetentionSweepDate(now);
  const retentionJobs = typeof jobQueue?.findByKind === "function"
    ? await jobQueue.findByKind({
      kind: SYSTEM_RETENTION_SWEEP_KIND,
      shopDomain: SYSTEM_JOB_SHOP_DOMAIN,
    })
    : [];
  const latestRetentionJobsByWindow = buildLatestRetentionJobsByWindow(retentionJobs);
  const latestRecordedWindowDate = [...latestRetentionJobsByWindow.keys()]
    .sort(compareIsoDateStrings)
    .at(-1) ?? null;
  const oldestOutstandingWindowDate = [...latestRetentionJobsByWindow.entries()]
    .filter(([, job]) => job.state === "dead_letter")
    .map(([windowDate]) => windowDate)
    .sort(compareIsoDateStrings)[0] ?? null;

  let nextWindowDate = oldestOutstandingWindowDate
    ?? (latestRecordedWindowDate == null
      ? latestDueWindowDate
      : addDaysToJstDate(latestRecordedWindowDate, 1));

  while (nextWindowDate <= latestDueWindowDate) {
    scheduledJobs.push(buildScheduledRetentionSweep(nextWindowDate, now));
    nextWindowDate = addDaysToJstDate(nextWindowDate, 1);
  }

  return scheduledJobs;
}

async function shouldSkipScheduledSystemJob({
  jobQueue,
  now = new Date(),
  scheduledJob,
  shopDomain = SYSTEM_JOB_SHOP_DOMAIN,
} = {}) {
  if (
    !SYSTEM_JOB_KINDS.includes(scheduledJob?.kind)
    || typeof jobQueue?.findLatestByDedupeKey !== "function"
  ) {
    return false;
  }

  const existingJob = await jobQueue.findLatestByDedupeKey({
    dedupeKey: scheduledJob.dedupeKey,
    kind: scheduledJob.kind,
    shopDomain,
  });

  if (existingJob?.state !== "dead_letter") {
    return false;
  }

  const cooldownMs = SYSTEM_JOB_DEAD_LETTER_RETRY_COOLDOWN_MS[scheduledJob.kind] ?? 0;
  if (cooldownMs <= 0) {
    return false;
  }

  const deadLetteredAt = existingJob.deadLetteredAt ?? existingJob.updatedAt ?? existingJob.createdAt;
  if (!(deadLetteredAt instanceof Date)) {
    return false;
  }

  return (deadLetteredAt.getTime() + cooldownMs) > now.getTime();
}

export async function enqueueDueSystemJobs({
  jobQueue,
  logger = console,
  now = new Date(),
} = {}) {
  if (typeof jobQueue?.enqueue !== "function") {
    return [];
  }

  const enqueued = [];
  for (const scheduledJob of await buildScheduledSystemJobs({ jobQueue, now })) {
    if (await shouldSkipScheduledSystemJob({ jobQueue, now, scheduledJob })) {
      logger.info?.("Bootstrap worker deferred retry for a dead-lettered scheduled system job window", {
        dedupeKey: scheduledJob.dedupeKey,
        kind: scheduledJob.kind,
      });
      continue;
    }

    const job = await jobQueue.enqueue({
      dedupeKey: scheduledJob.dedupeKey,
      kind: scheduledJob.kind,
      maxAttempts: scheduledJob.maxAttempts,
      payload: scheduledJob.payload,
      shopDomain: SYSTEM_JOB_SHOP_DOMAIN,
    });

    if (job) {
      enqueued.push(job);
      logger.info?.("Bootstrap worker enqueued scheduled system job", {
        dedupeKey: scheduledJob.dedupeKey,
        jobId: job.id,
        kind: scheduledJob.kind,
      });
    }
  }

  return enqueued;
}

async function enqueueDueSystemJobsSafely({
  jobQueue,
  logger = console,
  now = new Date(),
  telemetry,
  workerId,
} = {}) {
  try {
    return await enqueueDueSystemJobs({
      jobQueue,
      logger,
      now,
    });
  } catch (error) {
    logger.error?.("Bootstrap worker failed to enqueue scheduled system jobs", {
      error,
      workerId,
    });
    telemetry?.emitEvent?.({
      error,
      event: "system.scheduler.enqueue_failed",
      level: "error",
      workerId,
    });
    return [];
  }
}

export async function cleanupCompletedRedactJob({
  jobId,
  logger = console,
  prisma,
  shopDomain,
} = {}) {
  if (!jobId || !shopDomain || typeof prisma?.$transaction !== "function") {
    return {
      deletedJobLeases: 0,
      deletedJobs: 0,
    };
  }

  const cleanup = await prisma.$transaction(async (tx) => {
    const deletedJobs = await tx.job.deleteMany({
      where: {
        id: jobId,
        shopDomain,
      },
    });

    const deletedJobLeases = await tx.jobLease.deleteMany({
      where: {
        jobId: null,
        leaseToken: null,
        shopDomain,
        workerId: null,
      },
    });

    return {
      deletedJobLeases: deletedJobLeases.count,
      deletedJobs: deletedJobs.count,
    };
  });

  logger.info?.("Bootstrap worker removed finalized shop redact lease state", {
    deletedJobLeases: cleanup.deletedJobLeases,
    deletedJobs: cleanup.deletedJobs,
    jobId,
    shopDomain,
  });

  return cleanup;
}

export class JobLeaseLostError extends Error {
  constructor(jobId) {
    super(`job-lease-lost:${jobId}`);
    this.code = "job-lease-lost";
    this.name = "JobLeaseLostError";
  }
}

export class JobFinalizeError extends Error {
  constructor(jobId, cause) {
    super(`job-finalize-failed:${jobId}`);
    this.code = "job-finalize-failed";
    this.cause = cause;
    this.name = "JobFinalizeError";
  }
}

export function waitForShutdownOrTimeout({
  milliseconds,
  shutdownPromise,
  sleep = delay,
}) {
  if (sleep === delay) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(undefined);
      }, milliseconds);

      shutdownPromise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  return Promise.race([sleep(milliseconds), shutdownPromise]);
}

export async function runJobWithLeaseHeartbeat({
  artifactStorage,
  artifactKeyPrefix,
  finalizeJob,
  heartbeatIntervalMs,
  job,
  jobQueue,
  leaseMs,
  logger = console,
  nowFn = Date.now,
  prisma,
  runJob = runWorkerJob,
  sleep = delay,
  workerId,
} = {}) {
  const stopHeartbeat = createDeferredSignal();
  const intervalMs = heartbeatIntervalMs ?? buildHeartbeatInterval(leaseMs);
  let heartbeatError = null;
  let runSucceeded = false;
  const assertJobLeaseActive = () => {
    if (heartbeatError) {
      throw heartbeatError;
    }
  };

  const heartbeatLoop = (async () => {
    let nextHeartbeatAt = nowFn() + intervalMs;

    while (true) {
      const waitMs = Math.max(0, nextHeartbeatAt - nowFn());
      const stopped = await waitForShutdownOrTimeout({
        milliseconds: waitMs,
        shutdownPromise: stopHeartbeat.promise,
        sleep,
      });

      if (stopped) {
        return;
      }

      if (stopHeartbeat.isResolved()) {
        return;
      }

      nextHeartbeatAt += intervalMs;

      try {
        const renewed = await jobQueue.heartbeat({
          jobId: job.id,
          leaseMs,
          workerId,
        });

        if (!renewed) {
          heartbeatError = new JobLeaseLostError(job.id);
          logger.telemetry?.emitCounterMetric?.({
            jobKind: job.kind,
            metricName: "LeaseLostJobs",
          });
          logger.telemetry?.emitEvent?.({
            event: "job.lease_lost",
            jobId: job.id,
            jobKind: job.kind,
            level: "error",
            shopDomain: job.shopDomain,
            workerId,
          });
          logger.error?.("Worker lease heartbeat lost", {
            jobId: job.id,
            workerId,
          });
          stopHeartbeat.resolve(true);
          return;
        }
      } catch (error) {
        heartbeatError = error;
        logger.error?.("Worker lease heartbeat failed", {
          error,
          jobId: job.id,
          workerId,
        });
        stopHeartbeat.resolve(true);
        return;
      }
    }
  })();

  try {
    const result = await runJob({
      artifactStorage,
      artifactKeyPrefix,
      assertJobLeaseActive,
      job,
      prisma,
    });
    if (finalizeJob) {
      await finalizeJob({ assertJobLeaseActive, result });
    }

    runSucceeded = true;
    stopHeartbeat.resolve(true);
    await heartbeatLoop;

    if (heartbeatError) {
      logger.error?.("Worker job finished after heartbeat failure", {
        heartbeatError,
        jobId: job.id,
        workerId,
      });
    }

    return result;
  } catch (error) {
    stopHeartbeat.resolve(true);
    await heartbeatLoop;

    if (heartbeatError && error !== heartbeatError && !runSucceeded) {
      logger.error?.("Worker job finished after heartbeat failure", {
        heartbeatError,
        jobId: job.id,
        workerId,
      });
    }

    throw error;
  }
}

export async function runBootstrapWorker({
  env = process.env,
  logger = console,
  artifactStorage: providedArtifactStorage,
  jobQueue: providedJobQueue,
  nowFn = () => new Date(),
  prisma: providedPrisma,
  processRef = process,
  runJob = runWorkerJob,
  workerId = buildWorkerId(),
} = {}) {
  const config = validateWorkerEnvironment(env);
  const prisma = providedPrisma ?? new PrismaClient();
  await prisma.$connect();
  const jobQueue = providedJobQueue ?? createPrismaJobQueue(prisma);
  const artifactStorage = providedArtifactStorage ?? createArtifactStorageFromEnv({ env });
  const telemetry = createTelemetry({
    env,
    logger,
    service: "worker",
  });
  logger.telemetry = telemetry;
  logger.info?.(`Bootstrap worker connected to PostgreSQL in ${config.awsRegion}`);

  let stopping = false;
  const shutdownSignal = createDeferredSignal();
  let activeJobPromise = null;

  const requestShutdown = (signal) => {
    if (stopping) {
      return;
    }

    stopping = true;
    shutdownSignal.resolve(signal);
    logger.info?.(`Bootstrap worker received ${signal}; draining in-flight job before disconnect`);
  };

  const handleSigint = () => {
    requestShutdown("SIGINT");
  };
  const handleSigterm = () => {
    requestShutdown("SIGTERM");
  };

  processRef.on("SIGINT", handleSigint);
  processRef.on("SIGTERM", handleSigterm);

  try {
    while (!stopping) {
      await enqueueDueSystemJobsSafely({
        jobQueue,
        logger,
        now: nowFn(),
        telemetry,
        workerId,
      });

      const job = await jobQueue.leaseNext({
        kinds: PRIORITIZED_SYSTEM_JOB_KINDS,
        leaseMs: config.queueLeaseMs,
        workerId,
      }) ?? await jobQueue.leaseNext({
        kinds: ORDINARY_WORKER_JOB_KINDS,
        leaseMs: config.queueLeaseMs,
        workerId,
      });

      if (stopping) {
        if (job) {
          const released = await jobQueue.release?.({
            jobId: job.id,
            workerId,
          });

          logger.info?.("Bootstrap worker skipped newly leased job during shutdown", {
            jobId: job.id,
            released: released ?? null,
            workerId,
          });
        }

        break;
      }

      if (!job) {
        logger.info?.(
          `Bootstrap worker idle tick leaseMs=${config.queueLeaseMs} pollMs=${config.pollIntervalMs}`,
        );
        await waitForShutdownOrTimeout({
          milliseconds: config.pollIntervalMs,
          shutdownPromise: shutdownSignal.promise,
        });
        continue;
      }

      activeJobPromise = (async () => {
        let runSucceeded = false;

        try {
          await runJobWithLeaseHeartbeat({
            artifactStorage,
            artifactKeyPrefix: config.artifactPrefix,
            finalizeJob: async ({ assertJobLeaseActive }) => {
              assertJobLeaseActive();
              const completed = await jobQueue.complete({
                jobId: job.id,
                workerId,
              });

              if (!completed) {
                throw new JobFinalizeError(job.id, new Error("stale-lease"));
              }

              if (job.kind === WEBHOOK_SHOP_REDACT_KIND) {
                await cleanupCompletedRedactJob({
                  jobId: job.id,
                  logger,
                  prisma,
                  shopDomain: job.shopDomain,
                });
              }
            },
            heartbeatIntervalMs: buildHeartbeatInterval(config.queueLeaseMs),
            job,
            jobQueue,
            leaseMs: config.queueLeaseMs,
            logger,
            prisma,
            runJob: (args) => runJob({
              ...args,
              leaseMs: config.queueLeaseMs,
              queueLeaseMs: config.queueLeaseMs,
              telemetry,
            }),
            workerId,
          });
          runSucceeded = true;
        } catch (error) {
          if (error instanceof JobFinalizeError) {
            logger.error?.("Worker job completed but state finalization failed", {
              error,
              jobId: job.id,
              kind: job.kind,
              runSucceeded,
              workerId,
            });
            throw error;
          }

          logger.error?.("Worker job failed", {
            error,
            jobId: job.id,
            kind: job.kind,
          });
          const failed = await jobQueue.fail({
            delayMs: 0,
            errorMessage: error?.code ?? error?.message ?? `${job.kind}-failed`,
            jobId: job.id,
            workerId,
          });

          if (!failed) {
            logger.error?.("Worker job state could not be finalized", {
              error,
              jobId: job.id,
              kind: job.kind,
              workerId,
            });
          }

          telemetry.emitEvent({
            error,
            event: "job.failed",
            jobId: job.id,
            jobKind: job.kind,
            level: "error",
            shopDomain: job.shopDomain,
            workerId,
          });

          if (job.kind === SYSTEM_RETENTION_SWEEP_KIND) {
            telemetry.emitCounterMetric({
              metricName: TELEMETRY_METRICS.RETENTION_SWEEP_FAILURES,
            });
            telemetry.emitEvent({
              error,
              event: "system.retention_sweep.failed",
              jobId: job.id,
              jobKind: job.kind,
              level: "error",
            });
          }

          if (job.kind === SYSTEM_STUCK_JOB_SWEEP_KIND) {
            telemetry.emitCounterMetric({
              metricName: "StuckJobSweepFailures",
            });
            telemetry.emitEvent({
              error,
              event: "system.stuck_job_sweep.failed",
              jobId: job.id,
              jobKind: job.kind,
              level: "error",
            });
          }

          if (failed?.state === "dead_letter") {
            telemetry.emitCounterMetric({
              metricName: "DeadLetteredJobs",
            });
            telemetry.emitEvent({
              event: "job.dead_lettered",
              jobId: job.id,
              jobKind: job.kind,
              shopDomain: job.shopDomain,
              workerId,
            });
          }

          return;
        }
      })();

      await activeJobPromise;
      activeJobPromise = null;
    }
  } finally {
    processRef.off("SIGINT", handleSigint);
    processRef.off("SIGTERM", handleSigterm);

    if (activeJobPromise) {
      await activeJobPromise.catch(() => {});
    }

    logger.info?.("Bootstrap worker disconnecting from PostgreSQL");
    await prisma.$disconnect();
  }
}

export async function runWorkerJob(args = {}) {
  if (args.job?.kind === WEBHOOK_SHOP_REDACT_KIND) {
    return runWebhookShopRedactJob(args);
  }

  if (args.job?.kind === SYSTEM_STUCK_JOB_SWEEP_KIND) {
    return runSystemStuckJobSweepJob(args);
  }

  if (args.job?.kind === SYSTEM_RETENTION_SWEEP_KIND) {
    return runSystemRetentionSweepJob(args);
  }

  throw new Error(`unsupported worker job kind: ${args.job?.kind ?? "unknown"}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runBootstrapWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
