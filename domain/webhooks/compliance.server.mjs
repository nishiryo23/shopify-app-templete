import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { createArtifactStorageFromEnv } from "../artifacts/factory.mjs";

export const COMPLIANCE_TOPICS = Object.freeze([
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]);

const COMPLIANCE_TOPIC_SET = new Set(COMPLIANCE_TOPICS);

export function isComplianceTopic(topic) {
  return COMPLIANCE_TOPIC_SET.has(topic);
}

export function buildMetadataOnlyWebhookInboxData({ processedAt = new Date() } = {}) {
  return {
    hmacHeader: null,
    processedAt,
    rawBody: null,
  };
}

async function deleteArtifactsWithBackup({
  artifactStorage,
  artifacts,
  assertJobLeaseActive = () => {},
}) {
  let backupDirPath = null;
  const deletedArtifacts = [];

  try {
    for (const artifact of artifacts) {
      assertJobLeaseActive();
      const storedObject = typeof artifactStorage.get === "function"
        ? await artifactStorage.get(artifact.objectKey)
        : undefined;

      if (storedObject != null) {
        const body = Buffer.isBuffer(storedObject) ? storedObject : storedObject.body;
        if (body != null) {
          backupDirPath ??= await mkdtemp(path.join(os.tmpdir(), "shopify-matri-shop-redact-"));
          const backupFilePath = path.join(backupDirPath, `${deletedArtifacts.length}-${artifact.id}.bin`);
          await writeFile(backupFilePath, body);
          deletedArtifacts.push({
            artifact,
            backupFilePath,
          });
        }
      }

      assertJobLeaseActive();
      await artifactStorage.delete(artifact.objectKey);
    }
  } catch (error) {
    const restoreErrors = await restoreArtifacts({
      artifactStorage,
      deletedArtifacts,
    });
    if (restoreErrors.length > 0) {
      error.restoreErrors = restoreErrors;
    }
    await cleanupArtifactBackups({ backupDirPath });
    throw error;
  }

  return {
    backupDirPath,
    deletedArtifacts,
  };
}

async function cleanupArtifactBackups({ backupDirPath }) {
  if (!backupDirPath) {
    return;
  }

  await rm(backupDirPath, { force: true, recursive: true });
}

async function restoreArtifacts({
  artifactStorage,
  deletedArtifacts,
}) {
  if (typeof artifactStorage.put !== "function" || deletedArtifacts.length === 0) {
    return [];
  }

  const restoreErrors = [];
  for (const deletedArtifact of [...deletedArtifacts].reverse()) {
    if (!deletedArtifact.backupFilePath) {
      continue;
    }

    try {
      const body = await readFile(deletedArtifact.backupFilePath);
      await artifactStorage.put({
        body,
        contentType: deletedArtifact.artifact.contentType ?? "application/octet-stream",
        metadata: deletedArtifact.artifact.metadata ?? null,
        objectKey: deletedArtifact.artifact.objectKey,
        visibility: deletedArtifact.artifact.visibility ?? "private",
      });
    } catch (error) {
      restoreErrors.push({
        error,
        objectKey: deletedArtifact.artifact.objectKey,
      });
    }
  }

  return restoreErrors;
}

/**
 * @param {{
 *   artifactStorage?: {
 *     get?: (objectKey: string) => Promise<Buffer | { body?: Buffer | Uint8Array } | null>;
 *     delete: (objectKey: string) => Promise<unknown>;
 *     put?: (args: {
 *       body: Buffer | Uint8Array | string;
 *       contentType?: string;
 *       metadata?: Record<string, unknown> | null;
 *       objectKey?: string;
 *       visibility?: string;
 *     }) => Promise<unknown>;
 *   };
 *   prisma: {
 *     artifact: {
 *       findMany: (args: {
 *         select: {
 *           contentType: boolean;
 *           id: boolean;
 *           metadata: boolean;
 *           objectKey: boolean;
 *           visibility: boolean;
 *         };
 *         where: { shopDomain: string };
 *       }) => Promise<Array<{
 *         contentType: string | null;
 *         id: string;
 *         metadata: Record<string, unknown> | null;
 *         objectKey: string;
 *         visibility: string | null;
 *       }>>;
 *     };
 *     $transaction: <T>(callback: (tx: any) => Promise<T>) => Promise<T>;
 *   };
 *   preserveDeliveryKey?: string;
 *   preserveJobId?: string;
 *   processedAt?: Date;
 *   assertJobLeaseActive?: () => void;
 *   shopDomain: string;
 * }} params
 */
export async function eraseShopData({
  artifactStorage = createArtifactStorageFromEnv(),
  assertJobLeaseActive = () => {},
  prisma,
  preserveDeliveryKey,
  preserveJobId,
  processedAt = new Date(),
  shopDomain,
}) {
  const artifacts = await prisma.artifact.findMany({
    select: {
      contentType: true,
      id: true,
      metadata: true,
      objectKey: true,
      visibility: true,
    },
    where: { shopDomain },
  });

  const {
    backupDirPath,
    deletedArtifacts,
  } = await deleteArtifactsWithBackup({
    artifactStorage,
    artifacts,
    assertJobLeaseActive,
  });

  try {
    assertJobLeaseActive();
    const result = await prisma.$transaction(async (tx) => {
      const deletedArtifactRows = await tx.artifact.deleteMany({
        where: { shopDomain },
      });
      const deletedJobs = await tx.job.deleteMany({
        where: preserveJobId
          ? {
            id: { not: preserveJobId },
            shopDomain,
          }
          : { shopDomain },
      });
      const deletedJobLeases = await tx.jobLease.deleteMany({
        where: preserveJobId
          ? {
            jobId: { not: preserveJobId },
            shopDomain,
          }
          : { shopDomain },
      });
      const deletedSessions = await tx.session.deleteMany({
        where: { shop: shopDomain },
      });
      const deletedShopStates = await tx.shop.deleteMany({
        where: { shopDomain },
      });

      if (preserveDeliveryKey) {
        await tx.webhookInbox.updateMany({
          data: buildMetadataOnlyWebhookInboxData({ processedAt }),
          where: {
            deliveryKey: preserveDeliveryKey,
            shopDomain,
          },
        });
      }

      const deletedWebhookInboxRows = await tx.webhookInbox.deleteMany({
        where: preserveDeliveryKey
          ? {
            deliveryKey: { not: preserveDeliveryKey },
            shopDomain,
          }
          : { shopDomain },
      });

      return {
        deletedArtifacts: deletedArtifactRows.count,
        deletedJobLeases: deletedJobLeases.count,
        deletedJobs: deletedJobs.count,
        deletedSessions: deletedSessions.count,
        deletedShopStates: deletedShopStates.count,
        deletedWebhookInboxRows: deletedWebhookInboxRows.count,
      };
    });
    await cleanupArtifactBackups({ backupDirPath });
    return result;
  } catch (error) {
    const restoreErrors = await restoreArtifacts({
      artifactStorage,
      deletedArtifacts,
    });
    if (restoreErrors.length > 0) {
      error.restoreErrors = restoreErrors;
    }
    await cleanupArtifactBackups({ backupDirPath });
    throw error;
  }
}
