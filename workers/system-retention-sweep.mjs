import { emitEvent, emitMetric, TELEMETRY_METRICS } from "../domain/telemetry/emf.mjs";
import { createPrismaArtifactCatalog } from "../domain/artifacts/prisma-artifact-catalog.mjs";
import {
  buildWebhookPayloadRedactionCutoff,
  buildJobAttemptRetentionCutoff,
} from "../domain/retention/policy.mjs";
import { resolveSweepTelemetry } from "./system-sweep-telemetry.mjs";

async function restoreArtifactObject({ artifact, artifactStorage, storedObject }) {
  const body = Buffer.isBuffer(storedObject)
    ? storedObject
    : storedObject?.body;

  if (!body || typeof artifactStorage.put !== "function") {
    return false;
  }

  await artifactStorage.put({
    body,
    contentType: artifact.contentType ?? "application/octet-stream",
    key: artifact.objectKey,
    metadata: artifact.metadata ?? null,
    visibility: artifact.visibility ?? "private",
  });

  return true;
}

async function cleanupExpiredArtifact({
  artifact,
  artifactCatalog,
  artifactStorage,
  assertJobLeaseActive = () => {},
  now,
}) {
  let objectState = "deleted";
  let stored;

  try {
    assertJobLeaseActive();
    stored = await artifactStorage.get(artifact.objectKey);
  } catch (error) {
    return {
      error,
      outcome: "storage_retry_needed",
    };
  }

  if (stored == null) {
    objectState = "already_missing";
  } else {
    try {
      assertJobLeaseActive();
      await artifactStorage.delete(artifact.objectKey);
    } catch (error) {
      return {
        error,
        outcome: "storage_retry_needed",
      };
    }
  }

  try {
    assertJobLeaseActive();
    await artifactCatalog.markDeleted({
      bucket: artifact.bucket,
      deletedAt: now,
      objectKey: artifact.objectKey,
    });
  } catch (error) {
    let restoreError = null;

    if (stored != null) {
      try {
        assertJobLeaseActive();
        await restoreArtifactObject({
          artifact,
          artifactStorage,
          storedObject: stored,
        });
      } catch (restoreFailure) {
        restoreError = restoreFailure;
      }
    }

    return {
      error: restoreError ?? error,
      outcome: "catalog_retry_needed",
    };
  }

  return { outcome: objectState };
}

function buildRetentionSweepRetryNeededError({
  artifactCleanupFailures,
  catalogRetryNeeded,
  storageRetryNeeded,
}) {
  const error = new Error("retention-sweep-retry-needed");
  error.code = "retention-sweep-retry-needed";
  error.artifactCleanupFailures = artifactCleanupFailures;
  error.catalogRetryNeeded = catalogRetryNeeded;
  error.storageRetryNeeded = storageRetryNeeded;
  return error;
}

export async function runSystemRetentionSweepJob({
  artifactCatalog,
  artifactStorage,
  assertJobLeaseActive = () => {},
  emit = { emitEvent, emitMetric },
  job,
  now = new Date(),
  prisma,
  telemetry,
} = {}) {
  const telemetryClient = resolveSweepTelemetry({ emit, telemetry });
  const catalog = artifactCatalog ?? createPrismaArtifactCatalog(prisma);
  assertJobLeaseActive();
  const expiredArtifacts = await prisma.artifact.findMany({
    orderBy: [{ createdAt: "asc" }],
    where: {
      deletedAt: null,
      retentionUntil: {
        lte: now,
        not: null,
      },
    },
  });

  const artifactSummary = {
    already_missing: 0,
    catalog_retry_needed: 0,
    deleted: 0,
    storage_retry_needed: 0,
  };

  for (const artifact of expiredArtifacts) {
    assertJobLeaseActive();
    const cleanup = await cleanupExpiredArtifact({
      artifact,
      artifactCatalog: catalog,
      artifactStorage,
      assertJobLeaseActive,
      now,
    });
    artifactSummary[cleanup.outcome] += 1;
  }

  const redactBefore = buildWebhookPayloadRedactionCutoff(now);
  assertJobLeaseActive();
  const redactedWebhookRows = await prisma.webhookInbox.updateMany({
    data: {
      hmacHeader: null,
      rawBody: null,
    },
    where: {
      createdAt: { lte: redactBefore },
      OR: [
        { rawBody: { not: null } },
        { hmacHeader: { not: null } },
      ],
    },
  });

  assertJobLeaseActive();
  const unprocessedResidueCount = await prisma.webhookInbox.count({
    where: {
      createdAt: { lte: redactBefore },
      processedAt: null,
    },
  });

  if (unprocessedResidueCount > 0) {
    telemetryClient.emitEvent({
      event: "webhook.unprocessed_residue_detected",
      count: unprocessedResidueCount,
      jobId: job?.id ?? null,
      level: "warn",
    });
  }

  assertJobLeaseActive();
  const deletedAttempts = await prisma.jobAttempt.deleteMany({
    where: {
      createdAt: { lte: buildJobAttemptRetentionCutoff(now) },
      job: {
        OR: [
          { completedAt: { not: null } },
          { deadLetteredAt: { not: null } },
        ],
      },
    },
  });

  const artifactCleanupFailures = artifactSummary.catalog_retry_needed + artifactSummary.storage_retry_needed;
  assertJobLeaseActive();
  if (artifactCleanupFailures > 0) {
    telemetryClient.emitCounterMetric({
      metricName: TELEMETRY_METRICS.RETENTION_SWEEP_FAILURES,
      value: artifactCleanupFailures,
    });
    telemetryClient.emitEvent({
      event: "system.retention_sweep.artifact_cleanup_retry_needed",
      artifactCleanupFailures,
      catalogRetryNeeded: artifactSummary.catalog_retry_needed,
      jobId: job?.id ?? null,
      level: "warn",
      storageRetryNeeded: artifactSummary.storage_retry_needed,
    });
  }

  telemetryClient.emitCounterMetric({
    metricName: TELEMETRY_METRICS.RETENTION_SWEEP_RUNS,
    value: 1,
  });

  if (artifactCleanupFailures > 0) {
    throw buildRetentionSweepRetryNeededError({
      artifactCleanupFailures,
      catalogRetryNeeded: artifactSummary.catalog_retry_needed,
      storageRetryNeeded: artifactSummary.storage_retry_needed,
    });
  }

  telemetryClient.emitEvent({
    event: "system.retention_sweep.completed",
    artifactCleanupFailures,
    artifactCleanupRetryNeeded: artifactSummary.catalog_retry_needed + artifactSummary.storage_retry_needed,
    artifactsCleanupStorageRetryNeeded: artifactSummary.storage_retry_needed,
    artifactsDeleted: artifactSummary.deleted,
    artifactsMissing: artifactSummary.already_missing,
    artifactsRetryNeeded: artifactSummary.catalog_retry_needed,
    attemptsDeleted: deletedAttempts.count,
    jobId: job?.id ?? null,
    redactedWebhookRows: redactedWebhookRows.count,
    unresolvedWebhookResidueCount: unprocessedResidueCount,
  });

  return {
    artifactSummary,
    attemptsDeleted: deletedAttempts.count,
    redactedWebhookRows: redactedWebhookRows.count,
    unresolvedWebhookResidueCount: unprocessedResidueCount,
  };
}
