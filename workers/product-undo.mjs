import { createPrismaArtifactCatalog } from "../domain/artifacts/prisma-artifact-catalog.mjs";
import { readProductsForPreview } from "../platform/shopify/product-preview.server.mjs";
import { updateProductCoreFields } from "../platform/shopify/product-write.server.mjs";
import { MissingOfflineSessionError, loadOfflineAdminContext } from "./offline-admin.mjs";
import {
  buildProductWriteArtifactKey,
  PRODUCT_UNDO_ERROR_ARTIFACT_KIND,
  PRODUCT_UNDO_RESULT_ARTIFACT_KIND,
} from "../domain/products/write-profile.mjs";
import {
  buildRollbackInputFromSnapshotRow,
  changedFieldsMatch,
} from "../domain/products/write-rows.mjs";

function extractArtifactBody(record) {
  if (Buffer.isBuffer(record)) {
    return record;
  }

  if (record && typeof record === "object" && "body" in record) {
    return record.body;
  }

  return null;
}

async function deleteIfPresent(storage, descriptor) {
  if (descriptor?.objectKey) {
    await storage.delete(descriptor);
  }
}

async function markDeletedIfPresent(catalog, descriptor) {
  if (descriptor?.bucket && descriptor?.objectKey) {
    await catalog.markDeleted({
      bucket: descriptor.bucket,
      objectKey: descriptor.objectKey,
    });
  }
}

async function loadArtifactRecordOrThrow(prisma, { artifactId, kind, shopDomain }) {
  const artifact = await prisma.artifact.findFirst({
    where: {
      deletedAt: null,
      id: artifactId,
      kind,
      shopDomain,
    },
  });

  if (!artifact) {
    throw new Error(`missing-artifact:${kind}`);
  }

  return artifact;
}

async function persistJsonArtifact({
  artifactCatalog,
  artifactKeyPrefix,
  artifactStorage,
  body,
  fileName,
  job,
  kind,
  metadata,
}) {
  let descriptor = null;
  let record = null;

  try {
    descriptor = await artifactStorage.put({
      body: JSON.stringify(body),
      contentType: "application/json",
      key: buildProductWriteArtifactKey({
        fileName,
        jobId: job.id,
        prefix: artifactKeyPrefix,
        shopDomain: job.shopDomain,
      }),
      metadata,
    });
    record = await artifactCatalog.record({
      ...descriptor,
      jobId: job.id,
      kind,
      metadata,
      retentionUntil: null,
      shopDomain: job.shopDomain,
    });
    return { descriptor, record };
  } catch (error) {
    await Promise.allSettled([
      markDeletedIfPresent(artifactCatalog, record),
      deleteIfPresent(artifactStorage, descriptor),
    ]);
    throw error;
  }
}

export async function runProductUndoJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  job,
  prisma,
  readLiveProducts = readProductsForPreview,
  resolveAdminContext = loadOfflineAdminContext,
  updateProduct = updateProductCoreFields,
} = {}) {
  const catalog = artifactCatalog ?? createPrismaArtifactCatalog(prisma);
  let errorArtifactDescriptor = null;
  let errorArtifactRecord = null;

  try {
    const payload = job.payload ?? {};
    const [writeArtifact, snapshotArtifact] = await Promise.all([
      loadArtifactRecordOrThrow(prisma, {
        artifactId: payload.writeArtifactId,
        kind: "product.write.result",
        shopDomain: job.shopDomain,
      }),
      loadArtifactRecordOrThrow(prisma, {
        artifactId: payload.snapshotArtifactId,
        kind: "product.write.snapshot",
        shopDomain: job.shopDomain,
      }),
    ]);

    const [writeRecord, snapshotRecord] = await Promise.all([
      artifactStorage.get(writeArtifact.objectKey),
      artifactStorage.get(snapshotArtifact.objectKey),
    ]);
    const writeBody = extractArtifactBody(writeRecord);
    const snapshotBody = extractArtifactBody(snapshotRecord);

    if (!writeBody || !snapshotBody) {
      throw new Error("missing-write-artifact-body");
    }

    const writePayload = JSON.parse(writeBody.toString("utf8"));
    const snapshotPayload = JSON.parse(snapshotBody.toString("utf8"));
    const snapshotRows = snapshotPayload.rows ?? [];
    const productIds = snapshotRows.map((row) => row.productId);

    const { admin } = await resolveAdminContext({
      prisma,
      shopDomain: job.shopDomain,
    });
    assertJobLeaseActive();
    const currentRowsByProductId = await readLiveProducts(admin, productIds, {
      assertJobLeaseActive,
    });

    const conflictingRows = snapshotRows.map((snapshotRow) => {
      const currentRow = currentRowsByProductId.get(snapshotRow.productId) ?? null;
      const writeRow = (writePayload.rows ?? []).find((row) => row.productId === snapshotRow.productId);
      const matches = changedFieldsMatch({
        actualRow: currentRow,
        changedFields: snapshotRow.changedFields,
        expectedRow: writeRow?.finalRow,
      });

      return {
        changedFields: snapshotRow.changedFields,
        conflict: !matches,
        currentRow,
        finalRow: writeRow?.finalRow ?? null,
        messages: matches ? [] : ["Live Shopify product drifted after the successful write"],
        productId: snapshotRow.productId,
        rollbackStatus: "skipped",
        snapshotRow: snapshotRow.preWriteRow,
        verificationStatus: matches ? "pending" : "conflict",
      };
    });

    if (conflictingRows.some((row) => row.conflict)) {
      const resultPayload = {
        outcome: "conflict",
        rows: conflictingRows,
        snapshotArtifactId: payload.snapshotArtifactId,
        summary: {
          total: conflictingRows.length,
        },
        writeJobId: payload.writeJobId,
      };
      await persistJsonArtifact({
        artifactCatalog: catalog,
        artifactKeyPrefix,
        artifactStorage,
        body: resultPayload,
        fileName: "undo-result.json",
        job,
        kind: PRODUCT_UNDO_RESULT_ARTIFACT_KIND,
        metadata: {
          outcome: "conflict",
          profile: payload.profile,
          total: conflictingRows.length,
          writeJobId: payload.writeJobId,
        },
      });
      return resultPayload;
    }

    const rollbackRows = [];
    for (const snapshotRow of snapshotRows) {
      assertJobLeaseActive();
      const mutation = buildRollbackInputFromSnapshotRow(snapshotRow);

      if (!mutation.ok) {
        rollbackRows.push({
          changedFields: snapshotRow.changedFields,
          conflict: false,
          currentRow: currentRowsByProductId.get(snapshotRow.productId) ?? null,
          finalRow: null,
          messages: mutation.errors,
          productId: snapshotRow.productId,
          rollbackStatus: "failed",
          snapshotRow: snapshotRow.preWriteRow,
          verificationStatus: "failed",
        });
        continue;
      }

      const response = await updateProduct(admin, mutation.input);
      const rollbackFailed = Array.isArray(response.userErrors) && response.userErrors.length > 0;
      rollbackRows.push({
        changedFields: snapshotRow.changedFields,
        conflict: false,
        currentRow: currentRowsByProductId.get(snapshotRow.productId) ?? null,
        finalRow: null,
        messages: rollbackFailed ? response.userErrors.map((entry) => entry.message) : [],
        productId: snapshotRow.productId,
        rollbackStatus: rollbackFailed ? "failed" : "success",
        snapshotRow: snapshotRow.preWriteRow,
        verificationStatus: rollbackFailed ? "failed" : "pending",
      });
    }

    assertJobLeaseActive();
    const finalRowsByProductId = await readLiveProducts(admin, productIds, {
      assertJobLeaseActive,
    });
    const verifiedRows = rollbackRows.map((row) => {
      const finalRow = finalRowsByProductId.get(row.productId) ?? null;
      if (row.rollbackStatus !== "success") {
        return {
          ...row,
          finalRow,
        };
      }

      const verified = changedFieldsMatch({
        actualRow: finalRow,
        changedFields: row.changedFields,
        expectedRow: row.snapshotRow,
      });
      return {
        ...row,
        finalRow,
        messages: verified ? row.messages : row.messages.concat("Undo verification failed"),
        verificationStatus: verified ? "verified" : "failed",
      };
    });

    const rollbackSuccessCount = verifiedRows.filter(
      (row) => row.rollbackStatus === "success" && row.verificationStatus === "verified",
    ).length;
    const outcome = rollbackSuccessCount === verifiedRows.length
      ? "verified_success"
      : rollbackSuccessCount === 0
        ? "verified_failure"
        : "partial_failure";
    const resultPayload = {
      outcome,
      rows: verifiedRows,
      snapshotArtifactId: payload.snapshotArtifactId,
      summary: {
        total: snapshotRows.length,
      },
      writeJobId: payload.writeJobId,
    };
    await persistJsonArtifact({
      artifactCatalog: catalog,
      artifactKeyPrefix,
      artifactStorage,
      body: resultPayload,
      fileName: "undo-result.json",
      job,
      kind: PRODUCT_UNDO_RESULT_ARTIFACT_KIND,
      metadata: {
        outcome,
        profile: payload.profile,
        total: snapshotRows.length,
        writeJobId: payload.writeJobId,
      },
    });
    return resultPayload;
  } catch (error) {
    if (error instanceof MissingOfflineSessionError) {
      error.code = "missing-offline-session";
    }

    try {
      const errorArtifact = await persistJsonArtifact({
        artifactCatalog: catalog,
        artifactKeyPrefix,
        artifactStorage,
        body: {
          code: error?.code ?? "product-undo-failed",
          message: error?.message ?? "product undo failed",
          profile: job.payload?.profile ?? null,
          writeJobId: job.payload?.writeJobId ?? null,
        },
        fileName: "undo-error.json",
        job,
        kind: PRODUCT_UNDO_ERROR_ARTIFACT_KIND,
        metadata: {
          code: error?.code ?? "product-undo-failed",
          profile: job.payload?.profile ?? null,
          writeJobId: job.payload?.writeJobId ?? null,
        },
      });
      errorArtifactDescriptor = errorArtifact.descriptor;
      errorArtifactRecord = errorArtifact.record;
    } catch {
      await Promise.allSettled([
        markDeletedIfPresent(catalog, errorArtifactRecord),
        deleteIfPresent(artifactStorage, errorArtifactDescriptor),
      ]);
    }

    throw error;
  }
}

