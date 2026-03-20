import test from "node:test";
import assert from "node:assert/strict";

import {
  ARTIFACT_RETENTION_DAYS,
  resolveArtifactRetentionUntil,
} from "../../domain/artifacts/retention.mjs";
import { buildWebhookPayloadRedactionCutoff } from "../../domain/retention/policy.mjs";
import {
  SYSTEM_RETENTION_SWEEP_KIND,
  SYSTEM_STUCK_JOB_SWEEP_KIND,
} from "../../domain/system-jobs.mjs";
import { createTelemetry } from "../../domain/telemetry/index.mjs";
import {
  hashTelemetryIdentifier,
  hashShopDomain,
  requireTelemetryPseudonymKey,
  TELEMETRY_METRICS,
  TELEMETRY_NAMESPACE,
} from "../../domain/telemetry/emf.mjs";
import { runSystemRetentionSweepJob } from "../../workers/system-retention-sweep.mjs";
import { runSystemStuckJobSweepJob } from "../../workers/system-stuck-job-sweep.mjs";

function createLogSink() {
  const lines = [];

  return {
    lines,
    log(line) {
      lines.push(JSON.parse(line));
    },
  };
}

test("telemetry helper emits EMF metrics with the fixed namespace and dimensions", () => {
  const sink = createLogSink();
  const telemetry = createTelemetry({
    env: {
      NODE_ENV: "production",
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
    logger: sink,
    service: "worker",
  });

  telemetry.emitCounterMetric({
    jobKind: "product.write",
    metricName: TELEMETRY_METRICS.LEASE_LOST_JOBS,
    value: 3,
  });
  telemetry.emitEvent({
    deliveryKey: "[\"example.myshopify.com\",\"app/uninstalled\",\"evt-1\",\"default\"]",
    event: "job.lease_lost",
    jobId: "job-1",
    jobKind: "product.write",
    level: "error",
    shopDomain: "example.myshopify.com",
    workerId: "worker-1",
  });

  assert.equal(sink.lines[0]._aws.CloudWatchMetrics[0].Namespace, TELEMETRY_NAMESPACE);
  assert.deepEqual(
    sink.lines[0]._aws.CloudWatchMetrics[0].Dimensions,
    [["Environment", "Service", "JobKind"]],
  );
  assert.equal(sink.lines[0].Environment, "production");
  assert.equal(sink.lines[0].Service, "worker");
  assert.equal(sink.lines[0].JobKind, "product.write");
  assert.equal(sink.lines[0].LeaseLostJobs, 3);
  assert.equal("shopDomain" in sink.lines[0], false);

  assert.equal(sink.lines[1].event, "job.lease_lost");
  assert.equal(sink.lines[1].jobKind, "product.write");
  assert.equal(sink.lines[1].kind, "product.write");
  assert.equal("deliveryKey" in sink.lines[1], false);
  assert.equal("shopDomain" in sink.lines[1], false);
  assert.equal(
    sink.lines[1].deliveryHash,
    hashTelemetryIdentifier("[\"example.myshopify.com\",\"app/uninstalled\",\"evt-1\",\"default\"]", {
      NODE_ENV: "production",
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 7).toString("base64"),
    }),
  );
  assert.equal(
    sink.lines[1].shopHash,
    hashShopDomain("example.myshopify.com", {
      NODE_ENV: "production",
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 7).toString("base64"),
    }),
  );
});

test("telemetry helper does not require a pseudonym key outside production to hash-less event logs", () => {
  assert.equal(hashShopDomain("example.myshopify.com", { NODE_ENV: "development" }), null);
  assert.throws(
    () => requireTelemetryPseudonymKey({ NODE_ENV: "production" }),
    /TELEMETRY_PSEUDONYM_KEY is required/,
  );
});

test("telemetry helper does not leak free-form error messages into errorCode", () => {
  const sink = createLogSink();
  const telemetry = createTelemetry({
    env: {
      NODE_ENV: "production",
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
    logger: sink,
    service: "worker",
  });

  telemetry.emitEvent({
    error: new Error("gid://shopify/Product/123 leaked in message"),
    event: "job.failed",
    jobId: "job-1",
    jobKind: "product.write",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(sink.lines[0].errorCode, "Error");
  assert.equal(JSON.stringify(sink.lines[0]).includes("gid://shopify/Product/123"), false);
});

test("artifact retention defaults resolve to the launch retention policy", () => {
  const now = new Date("2026-03-17T00:00:00.000Z");

  assert.equal(ARTIFACT_RETENTION_DAYS["product.preview.edited-upload"], 7);
  assert.equal(ARTIFACT_RETENTION_DAYS["product.write.result"], 90);
  assert.equal(
    resolveArtifactRetentionUntil({
      kind: "product.preview.edited-upload",
      now,
    }).toISOString(),
    "2026-03-24T00:00:00.000Z",
  );
  assert.equal(
    resolveArtifactRetentionUntil({
      kind: "product.write.snapshot",
      now,
    }).toISOString(),
    "2026-06-15T00:00:00.000Z",
  );
});

test("webhook payload redaction cutoff uses the actual sweep execution time", () => {
  assert.equal(
    buildWebhookPayloadRedactionCutoff(new Date("2026-03-16T18:00:00.000Z")).toISOString(),
    "2026-03-09T18:00:00.000Z",
  );
  assert.equal(
    buildWebhookPayloadRedactionCutoff(new Date("2026-03-17T00:00:00.000Z")).toISOString(),
    "2026-03-10T00:00:00.000Z",
  );
  assert.equal(
    buildWebhookPayloadRedactionCutoff(new Date("2026-03-17T01:00:00.000Z")).toISOString(),
    "2026-03-10T01:00:00.000Z",
  );
});

test("retention sweep redacts aged webhook payloads regardless of processing state and emits residue detection", async () => {
  const metrics = [];
  const events = [];
  const markedDeleted = [];
  const now = new Date("2026-03-17T09:00:00.000Z");

  const result = await runSystemRetentionSweepJob({
    artifactCatalog: {
      async markDeleted(args) {
        markedDeleted.push(args);
        return true;
      },
    },
    artifactStorage: {
      async delete() {
        return true;
      },
      async get() {
        return null;
      },
      async put() {
        return true;
      },
    },
    emit: {
      emitEvent(payload) {
        events.push(payload);
      },
      emitMetric(payload) {
        metrics.push(payload);
      },
    },
    job: {
      dedupeKey: "system:retention-sweep:2026-03-17",
      id: "system-job-1",
      kind: SYSTEM_RETENTION_SWEEP_KIND,
      payload: {
        windowDate: "2026-03-17",
      },
    },
    now,
    prisma: {
      artifact: {
        async findMany() {
          return [{
            bucket: "private-artifacts",
            objectKey: "jobs/job-1/result.json",
          }];
        },
      },
      jobAttempt: {
        async deleteMany({ where }) {
          assert.deepEqual(where.job.OR, [
            { completedAt: { not: null } },
            { deadLetteredAt: { not: null } },
          ]);
          return { count: 3 };
        },
      },
      webhookInbox: {
        async count({ where }) {
          assert.equal(where.processedAt, null);
          return 2;
        },
        async updateMany({ data, where }) {
          assert.deepEqual(data, { hmacHeader: null, rawBody: null });
          assert.deepEqual(where, {
            OR: [
              { rawBody: { not: null } },
              { hmacHeader: { not: null } },
            ],
            createdAt: {
              lte: new Date("2026-03-10T09:00:00.000Z"),
            },
          });
          return { count: 4 };
        },
      },
    },
  });

  assert.deepEqual(result.artifactSummary, {
    already_missing: 1,
    catalog_retry_needed: 0,
    deleted: 0,
    storage_retry_needed: 0,
  });
  assert.equal(result.attemptsDeleted, 3);
  assert.equal(result.redactedWebhookRows, 4);
  assert.equal(result.unresolvedWebhookResidueCount, 2);
  assert.equal(markedDeleted.length, 1);
  assert.equal(metrics[0].metricName, TELEMETRY_METRICS.RETENTION_SWEEP_RUNS);
  assert.equal(events[0].event, "webhook.unprocessed_residue_detected");
  assert.equal(events[1].event, "system.retention_sweep.completed");
});

test("retention sweep stops before destructive follow-up work when the lease fence is lost", async () => {
  let assertCalls = 0;
  let redactionCalls = 0;
  let deletedAttemptsCalls = 0;

  await assert.rejects(
    () => runSystemRetentionSweepJob({
      artifactCatalog: {
        async markDeleted() {
          return true;
        },
      },
      artifactStorage: {
        async delete() {
          return true;
        },
        async get() {
          return null;
        },
        async put() {
          return true;
        },
      },
      assertJobLeaseActive() {
        assertCalls += 1;
        if (assertCalls >= 3) {
          throw new Error("lease-lost");
        }
      },
      emit: {
        emitEvent() {},
        emitMetric() {},
      },
      job: { id: "system-job-lease-lost", kind: SYSTEM_RETENTION_SWEEP_KIND },
      prisma: {
        artifact: {
          async findMany() {
            return [{
              bucket: "private-artifacts",
              objectKey: "jobs/job-1/result.json",
            }];
          },
        },
        jobAttempt: {
          async deleteMany() {
            deletedAttemptsCalls += 1;
            return { count: 0 };
          },
        },
        webhookInbox: {
          async count() {
            return 0;
          },
          async updateMany() {
            redactionCalls += 1;
            return { count: 0 };
          },
        },
      },
    }),
    /lease-lost/,
  );

  assert.equal(redactionCalls, 0);
  assert.equal(deletedAttemptsCalls, 0);
});

test("retention sweep fails after continuing other retention duties when artifact cleanup needs retry", async () => {
  const metrics = [];
  const events = [];

  await assert.rejects(
    () => runSystemRetentionSweepJob({
      artifactCatalog: {
        async markDeleted() {
          throw new Error("catalog unavailable");
        },
      },
      artifactStorage: {
        async delete() {
          return true;
        },
        async get() {
          return Buffer.from("artifact-body");
        },
        async put() {
          return true;
        },
      },
      emit: {
        emitEvent(payload) {
          events.push(payload);
        },
        emitMetric(payload) {
          metrics.push(payload);
        },
      },
      job: { id: "system-job-1", kind: SYSTEM_RETENTION_SWEEP_KIND },
      prisma: {
        artifact: {
          async findMany() {
            return [{
              bucket: "private-artifacts",
              contentType: "application/json",
              metadata: { artifact: true },
              objectKey: "jobs/job-1/result.json",
            }];
          },
        },
        jobAttempt: {
          async deleteMany() {
            return { count: 2 };
          },
        },
        webhookInbox: {
          async count() {
            return 0;
          },
          async updateMany() {
            return { count: 1 };
          },
        },
      },
    }),
    (error) => error?.code === "retention-sweep-retry-needed"
      && error?.artifactCleanupFailures === 1
      && error?.catalogRetryNeeded === 1
      && error?.storageRetryNeeded === 0,
  );

  assert.equal(metrics[0].metricName, TELEMETRY_METRICS.RETENTION_SWEEP_FAILURES);
  assert.equal(metrics[0].value, 1);
  assert.equal(metrics[1].metricName, TELEMETRY_METRICS.RETENTION_SWEEP_RUNS);
  assert.equal(events[0].event, "system.retention_sweep.artifact_cleanup_retry_needed");
  assert.equal(events.some((event) => event.event === "system.retention_sweep.completed"), false);
});

test("retention sweep fails after keeping redaction and attempt pruning running when artifact reads fail", async () => {
  const metrics = [];
  const events = [];

  await assert.rejects(
    () => runSystemRetentionSweepJob({
      artifactCatalog: {
        async markDeleted() {
          throw new Error("should not mark deleted after read failure");
        },
      },
      artifactStorage: {
        async delete() {
          throw new Error("should not delete after read failure");
        },
        async get() {
          throw new Error("s3 read timeout");
        },
        async put() {
          return true;
        },
      },
      emit: {
        emitEvent(payload) {
          events.push(payload);
        },
        emitMetric(payload) {
          metrics.push(payload);
        },
      },
      job: { id: "system-job-1", kind: SYSTEM_RETENTION_SWEEP_KIND },
      prisma: {
        artifact: {
          async findMany() {
            return [{
              bucket: "private-artifacts",
              objectKey: "jobs/job-1/result.json",
            }];
          },
        },
        jobAttempt: {
          async deleteMany() {
            return { count: 5 };
          },
        },
        webhookInbox: {
          async count() {
            return 0;
          },
          async updateMany() {
            return { count: 2 };
          },
        },
      },
    }),
    (error) => error?.code === "retention-sweep-retry-needed"
      && error?.artifactCleanupFailures === 1
      && error?.catalogRetryNeeded === 0
      && error?.storageRetryNeeded === 1,
  );

  assert.equal(metrics[0].metricName, TELEMETRY_METRICS.RETENTION_SWEEP_FAILURES);
  assert.equal(metrics[0].value, 1);
  assert.equal(metrics[1].metricName, TELEMETRY_METRICS.RETENTION_SWEEP_RUNS);
  assert.equal(events[0].event, "system.retention_sweep.artifact_cleanup_retry_needed");
  assert.equal(events.some((event) => event.event === "system.retention_sweep.completed"), false);
});

test("stuck-job sweep emits detection gauge before recovery and counts recovered stale jobs", async () => {
  const metrics = [];
  const events = [];

  const result = await runSystemStuckJobSweepJob({
    emit: {
      emitEvent(payload) {
        events.push(payload);
      },
      emitMetric(payload) {
        metrics.push(payload);
      },
    },
    job: { id: "system-job-2", kind: SYSTEM_STUCK_JOB_SWEEP_KIND },
    jobQueue: {
      async recoverStaleLease({ jobId }) {
        return jobId === "stale-job-1"
          ? { nextState: "retryable", recovered: true }
          : { recovered: false, reason: "lease-changed" };
      },
    },
    now: new Date("2026-03-17T09:35:00.000Z"),
    prisma: {
      job: {
        async count() {
          return 1;
        },
        async findMany() {
          return [{ id: "stale-job-1" }, { id: "stale-job-2" }];
        },
      },
    },
    queueLeaseMs: 300_000,
  });

  assert.deepEqual(result, {
    detectedStaleJobs: 2,
    recoveredStaleJobs: 1,
    unresolvedStaleJobs: 1,
    skippedStaleJobs: 1,
  });
  assert.equal(metrics[0].metricName, TELEMETRY_METRICS.STALE_LEASED_JOBS);
  assert.equal(metrics[0].value, 1);
  assert.equal(metrics[1].metricName, TELEMETRY_METRICS.RECOVERED_STALE_LEASED_JOBS);
  assert.equal(metrics[1].value, 1);
  assert.equal(events[0].event, "system.stuck_job_sweep.completed");
  assert.equal(events[0].fields.unresolvedStaleJobs, 1);
});

test("stuck-job sweep emits dead-letter telemetry when stale recovery exhausts retries", async () => {
  const metrics = [];
  const events = [];

  const result = await runSystemStuckJobSweepJob({
    emit: {
      emitEvent(payload) {
        events.push(payload);
      },
      emitMetric(payload) {
        metrics.push(payload);
      },
    },
    job: { id: "system-job-3", kind: SYSTEM_STUCK_JOB_SWEEP_KIND },
    jobQueue: {
      async recoverStaleLease() {
        return { nextState: "dead_letter", recovered: true };
      },
    },
    now: new Date("2026-03-17T09:35:00.000Z"),
    prisma: {
      job: {
        async count() {
          return 0;
        },
        async findMany() {
          return [{
            id: "stale-job-dead-letter",
            kind: "product.write",
            shopDomain: "example.myshopify.com",
          }];
        },
      },
    },
    queueLeaseMs: 300_000,
  });

  assert.deepEqual(result, {
    detectedStaleJobs: 1,
    recoveredStaleJobs: 1,
    unresolvedStaleJobs: 0,
    skippedStaleJobs: 0,
  });
  assert.equal(metrics[0].metricName, TELEMETRY_METRICS.DEAD_LETTERED_JOBS);
  assert.equal(metrics[0].value, 1);
  assert.equal(metrics[1].metricName, TELEMETRY_METRICS.STALE_LEASED_JOBS);
  assert.equal(metrics[1].value, 0);
  assert.equal(metrics[2].metricName, TELEMETRY_METRICS.RECOVERED_STALE_LEASED_JOBS);
  assert.equal(metrics[2].value, 1);
  assert.equal(events[0].event, "job.dead_lettered");
  assert.equal(events[0].fields.jobId, "stale-job-dead-letter");
  assert.equal(events[0].fields.jobKind, "product.write");
  assert.equal(events[0].fields.shopDomain, "example.myshopify.com");
  assert.equal(events[1].event, "system.stuck_job_sweep.completed");
});

test("stuck-job sweep uses provided telemetry to pseudonymize dead-letter events", async () => {
  const sink = createLogSink();
  const telemetry = createTelemetry({
    env: {
      NODE_ENV: "production",
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 9).toString("base64"),
    },
    logger: sink,
    service: "worker",
  });

  await runSystemStuckJobSweepJob({
    job: { id: "system-job-telemetry", kind: SYSTEM_STUCK_JOB_SWEEP_KIND },
    jobQueue: {
      async recoverStaleLease() {
        return { nextState: "dead_letter", recovered: true };
      },
    },
    now: new Date("2026-03-17T09:35:00.000Z"),
    prisma: {
      job: {
        async count() {
          return 0;
        },
        async findMany() {
          return [{
            id: "stale-job-dead-letter",
            kind: "product.write",
            shopDomain: "example.myshopify.com",
          }];
        },
      },
    },
    queueLeaseMs: 300_000,
    telemetry,
  });

  assert.equal(sink.lines[0].DeadLetteredJobs, 1);
  assert.equal(sink.lines[1].event, "job.dead_lettered");
  assert.equal(sink.lines[1].jobId, "stale-job-dead-letter");
  assert.equal(sink.lines[1].jobKind, "product.write");
  assert.equal("shopDomain" in sink.lines[1], false);
  assert.equal(
    sink.lines[1].shopHash,
    hashShopDomain("example.myshopify.com", {
      NODE_ENV: "production",
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 9).toString("base64"),
    }),
  );
});

test("stuck-job sweep honors non-default queue lease windows when computing stale cutoff", async () => {
  const scannedWhere = [];

  await runSystemStuckJobSweepJob({
    emit: {
      emitEvent() {},
      emitMetric() {},
    },
    jobQueue: {
      async recoverStaleLease() {
        return { recovered: false, reason: "not-stale" };
      },
    },
    now: new Date("2026-03-17T09:35:00.000Z"),
    prisma: {
      job: {
        async count() {
          return 0;
        },
        async findMany({ where }) {
          scannedWhere.push(where);
          return [];
        },
      },
    },
    queueLeaseMs: 420_000,
  });

  assert.deepEqual(scannedWhere, [{
    leaseExpiresAt: { lte: new Date("2026-03-17T09:21:00.000Z") },
    state: "leased",
  }]);
});

test("stuck-job sweep stops recovering additional jobs when the lease fence is lost", async () => {
  let assertCalls = 0;
  const recoveredJobIds = [];

  await assert.rejects(
    () => runSystemStuckJobSweepJob({
      assertJobLeaseActive() {
        assertCalls += 1;
        if (assertCalls >= 3) {
          throw new Error("lease-lost");
        }
      },
      emit: {
        emitEvent() {},
        emitMetric() {},
      },
      jobQueue: {
        async recoverStaleLease({ jobId }) {
          recoveredJobIds.push(jobId);
          return { nextState: "retryable", recovered: true };
        },
      },
      now: new Date("2026-03-17T09:35:00.000Z"),
      prisma: {
        job: {
          async findMany() {
            return [{ id: "stale-job-1" }, { id: "stale-job-2" }];
          },
        },
      },
      queueLeaseMs: 300_000,
    }),
    /lease-lost/,
  );

  assert.deepEqual(recoveredJobIds, ["stale-job-1"]);
});
