import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createArtifactStorageFromEnv } from "../domain/artifacts/factory.mjs";
import { createPrismaJobQueue } from "../domain/jobs/prisma-job-queue.mjs";
import { PRODUCT_EXPORT_KIND } from "../domain/products/export-profile.mjs";
import { PRODUCT_PREVIEW_KIND } from "../domain/products/preview-profile.mjs";
import {
  PRODUCT_UNDO_KIND,
  PRODUCT_WRITE_KIND,
} from "../domain/products/write-profile.mjs";
import { runProductExportJob } from "./product-export.mjs";
import { runProductUndoJob } from "./product-undo.mjs";
import { runProductPreviewJob } from "./product-preview.mjs";
import { runProductWriteJob } from "./product-write.mjs";

const ALWAYS_REQUIRED_WORKER_SECRETS = Object.freeze([
  "DATABASE_URL",
  "PROVENANCE_SIGNING_KEY",
  "SHOPIFY_API_SECRET",
  "SHOP_TOKEN_ENCRYPTION_KEY",
]);

const PRODUCTION_ONLY_WORKER_SECRETS = Object.freeze([]);

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

  parseBase64Secret(env.PROVENANCE_SIGNING_KEY, "PROVENANCE_SIGNING_KEY");
  parseBase64Secret(env.SHOP_TOKEN_ENCRYPTION_KEY, "SHOP_TOKEN_ENCRYPTION_KEY");

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
      timer.unref?.();

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
  runJob = runProductExportJob,
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
      const job = await jobQueue.leaseNext({
        kinds: [PRODUCT_EXPORT_KIND, PRODUCT_PREVIEW_KIND, PRODUCT_WRITE_KIND, PRODUCT_UNDO_KIND],
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
            },
            heartbeatIntervalMs: buildHeartbeatInterval(config.queueLeaseMs),
            job,
            jobQueue,
            leaseMs: config.queueLeaseMs,
            logger,
            prisma,
            runJob,
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
  if (args.job?.kind === PRODUCT_UNDO_KIND) {
    return runProductUndoJob(args);
  }

  if (args.job?.kind === PRODUCT_WRITE_KIND) {
    return runProductWriteJob(args);
  }

  if (args.job?.kind === PRODUCT_PREVIEW_KIND) {
    return runProductPreviewJob(args);
  }

  return runProductExportJob(args);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runBootstrapWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
