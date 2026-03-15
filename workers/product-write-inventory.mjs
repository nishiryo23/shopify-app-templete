import crypto from "node:crypto";
import { createPrismaArtifactCatalog } from "../domain/artifacts/prisma-artifact-catalog.mjs";
import {
  buildProductWriteArtifactKey,
  PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
  PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
  PRODUCT_WRITE_SNAPSHOT_ARTIFACT_KIND,
} from "../domain/products/write-profile.mjs";
import {
  buildInventoryReferenceDocumentUri,
  buildInventorySetQuantityInputFromPreviewRow,
  buildInventorySummary,
  getWritableInventoryPreviewRows,
  inventoryChangedFieldsMatch,
} from "../domain/inventory/write-rows.mjs";
import { inventoryWriteRowsMatch } from "../domain/inventory/write-rows.mjs";
import {
  readInventoryLevelsForProducts,
  setInventoryQuantities,
} from "../platform/shopify/product-inventory.server.mjs";
import { MissingOfflineSessionError, loadOfflineAdminContext } from "./offline-admin.mjs";

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

function buildBusinessOutcome(rows) {
  const successCount = rows.filter((row) => row.verificationStatus === "verified").length;
  const failureCount = rows.length - successCount;

  if (failureCount === 0) {
    return "verified_success";
  }

  if (successCount === 0) {
    return "verified_failure";
  }

  return "partial_failure";
}

function buildUserErrorMap(userErrors) {
  const errorsByIndex = new Map();

  for (const error of userErrors ?? []) {
    const indexToken = (error.field ?? []).find((token) => /^\d+$/.test(String(token)));
    const index = indexToken == null ? null : Number(indexToken);

    if (index == null || Number.isNaN(index)) {
      continue;
    }

    const current = errorsByIndex.get(index) ?? [];
    current.push(error);
    errorsByIndex.set(index, current);
  }

  return errorsByIndex;
}

function buildRevalidationFailedResult({ payload, rows }) {
  return {
    outcome: "revalidation_failed",
    previewDigest: payload.previewDigest,
    previewJobId: payload.previewJobId,
    profile: payload.profile,
    rows,
    snapshotArtifactId: null,
    summary: {
      total: rows.length,
    },
  };
}

function buildRowKey(row) {
  return `${row?.variantId ?? row?.variant_id ?? ""}\u001e${row?.locationId ?? row?.location_id ?? ""}`;
}

export async function runInventoryProductWriteJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  job,
  prisma,
  readLiveInventory = readInventoryLevelsForProducts,
  resolveAdminContext = loadOfflineAdminContext,
  setInventoryQuantities: updateInventory = setInventoryQuantities,
} = {}) {
  const catalog = artifactCatalog ?? createPrismaArtifactCatalog(prisma);
  let errorArtifactDescriptor = null;
  let errorArtifactRecord = null;
  let skipErrorArtifactPersistence = false;

  try {
    const payload = job.payload ?? {};
    const previewArtifact = await loadArtifactRecordOrThrow(prisma, {
      artifactId: payload.previewArtifactId,
      kind: "product.preview.result",
      shopDomain: job.shopDomain,
    });
    const previewRecord = await artifactStorage.get(previewArtifact.objectKey);
    const previewBody = extractArtifactBody(previewRecord);

    if (!previewBody) {
      throw new Error("missing-preview-result-body");
    }

    const previewPayload = JSON.parse(previewBody.toString("utf8"));
    const writableRows = getWritableInventoryPreviewRows(previewPayload.rows);

    if (writableRows.length === 0) {
      const resultPayload = buildRevalidationFailedResult({
        payload,
        rows: [],
      });
      await persistJsonArtifact({
        artifactCatalog: catalog,
        artifactKeyPrefix,
        artifactStorage,
        body: resultPayload,
        fileName: "result.json",
        job,
        kind: PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
        metadata: {
          outcome: resultPayload.outcome,
          previewDigest: payload.previewDigest,
          previewJobId: payload.previewJobId,
          profile: payload.profile,
          total: resultPayload.summary.total,
        },
      });
      return resultPayload;
    }

    const productIds = [...new Set(writableRows.map((row) => row.productId).filter(Boolean))];
    const { admin } = await resolveAdminContext({
      prisma,
      shopDomain: job.shopDomain,
    });

    assertJobLeaseActive();
    const {
      rowsByKey: revalidatedRowsByKey,
    } = await readLiveInventory(admin, productIds, { assertJobLeaseActive });

    const revalidationRows = writableRows.map((row) => {
      const currentRow = revalidatedRowsByKey.get(buildRowKey(row)) ?? null;
      const matchesPreview = Boolean(currentRow)
        && currentRow.product_id === row.productId
        && inventoryWriteRowsMatch(currentRow, row.currentRow);

      return {
        changedFields: row.changedFields,
        currentRow,
        editedRow: row.editedRow,
        editedRowNumber: row.editedRowNumber,
        finalRow: currentRow,
        locationId: row.locationId,
        messages: matchesPreview ? [] : ["Live Shopify inventory level changed after preview confirmation was requested"],
        mutationStatus: "skipped",
        mutationUserErrors: [],
        operation: row.operation,
        preWriteRow: currentRow,
        productId: row.productId,
        variantId: row.variantId,
        verificationStatus: matchesPreview ? "pending" : "revalidation_failed",
      };
    });

    if (revalidationRows.some((row) => row.verificationStatus === "revalidation_failed")) {
      const resultPayload = buildRevalidationFailedResult({
        payload,
        rows: revalidationRows,
      });
      await persistJsonArtifact({
        artifactCatalog: catalog,
        artifactKeyPrefix,
        artifactStorage,
        body: resultPayload,
        fileName: "result.json",
        job,
        kind: PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
        metadata: {
          outcome: resultPayload.outcome,
          previewDigest: payload.previewDigest,
          previewJobId: payload.previewJobId,
          profile: payload.profile,
          total: resultPayload.summary.total,
        },
      });
      return resultPayload;
    }

    const snapshotPayload = {
      previewDigest: payload.previewDigest,
      previewJobId: payload.previewJobId,
      profile: payload.profile,
      rows: revalidationRows.map((row) => ({
        changedFields: row.changedFields,
        currentRow: row.currentRow,
        editedRow: row.editedRow,
        editedRowNumber: row.editedRowNumber,
        locationId: row.locationId,
        operation: row.operation,
        preWriteRow: row.preWriteRow,
        productId: row.productId,
        variantId: row.variantId,
      })),
    };

    const snapshotArtifact = await persistJsonArtifact({
      artifactCatalog: catalog,
      artifactKeyPrefix,
      artifactStorage,
      body: snapshotPayload,
      fileName: "snapshot.json",
      job,
      kind: PRODUCT_WRITE_SNAPSHOT_ARTIFACT_KIND,
      metadata: {
        previewDigest: payload.previewDigest,
        previewJobId: payload.previewJobId,
        profile: payload.profile,
        total: snapshotPayload.rows.length,
      },
    });

    const mutationRows = [];
    let infrastructureError = null;

    for (let index = 0; index < revalidationRows.length; index += 250) {
      assertJobLeaseActive();
      const chunkRows = revalidationRows.slice(index, index + 250);
      const chunkInputs = [];
      const inputRows = [];

      for (const row of chunkRows) {
        const mutation = buildInventorySetQuantityInputFromPreviewRow(row);
        if (!mutation.ok) {
          mutationRows.push({
            changedFields: row.changedFields,
            currentRow: row.currentRow,
            editedRow: row.editedRow,
            editedRowNumber: row.editedRowNumber,
            finalRow: null,
            locationId: row.locationId,
            messages: mutation.errors,
            mutationStatus: "failed",
            mutationUserErrors: mutation.errors.map((message) => ({ field: [], message })),
            operation: row.operation,
            preWriteRow: row.preWriteRow,
            productId: row.productId,
            variantId: row.variantId,
            verificationStatus: "failed",
          });
          continue;
        }

        chunkInputs.push(mutation.input);
        inputRows.push(row);
      }

      if (chunkInputs.length === 0) {
        continue;
      }

      try {
        const response = await updateInventory(admin, {
          idempotencyKey: crypto.randomUUID(),
          quantities: chunkInputs,
          referenceDocumentUri: buildInventoryReferenceDocumentUri(payload.previewJobId),
        });
        const errorsByIndex = buildUserErrorMap(response.userErrors);
        for (let rowIndex = 0; rowIndex < inputRows.length; rowIndex += 1) {
          const row = inputRows[rowIndex];
          const rowErrors = errorsByIndex.get(rowIndex) ?? [];
          const mutationFailed = rowErrors.length > 0 || (
            errorsByIndex.size === 0
            && Array.isArray(response.userErrors)
            && response.userErrors.length > 0
          );
          mutationRows.push({
            changedFields: row.changedFields,
            currentRow: row.currentRow,
            editedRow: row.editedRow,
            editedRowNumber: row.editedRowNumber,
            finalRow: null,
            locationId: row.locationId,
            messages: mutationFailed ? (rowErrors.length > 0
              ? rowErrors.map((error) => error.message)
              : response.userErrors.map((error) => error.message)) : [],
            mutationStatus: mutationFailed ? "failed" : "success",
            mutationUserErrors: mutationFailed ? (rowErrors.length > 0 ? rowErrors : response.userErrors) : [],
            operation: row.operation,
            preWriteRow: row.preWriteRow,
            productId: row.productId,
            variantId: row.variantId,
            verificationStatus: mutationFailed ? "failed" : "pending",
          });
        }
      } catch (error) {
        infrastructureError = error;
        for (const row of inputRows) {
          mutationRows.push({
            changedFields: row.changedFields,
            currentRow: row.currentRow,
            editedRow: row.editedRow,
            editedRowNumber: row.editedRowNumber,
            finalRow: null,
            locationId: row.locationId,
            messages: [error instanceof Error ? error.message : "inventory update failed"],
            mutationStatus: "failed",
            mutationUserErrors: [],
            operation: row.operation,
            preWriteRow: row.preWriteRow,
            productId: row.productId,
            variantId: row.variantId,
            verificationStatus: "pending",
          });
        }
        break;
      }
    }

    assertJobLeaseActive();
    const {
      rowsByKey: finalRowsByKey,
    } = await readLiveInventory(admin, productIds, { assertJobLeaseActive });

    const verifiedRows = mutationRows.map((row) => {
      const finalRow = finalRowsByKey.get(buildRowKey(row)) ?? null;

      if (row.verificationStatus === "skipped" || row.verificationStatus === "failed") {
        return {
          ...row,
          finalRow,
        };
      }

      const verified = Boolean(finalRow)
        && finalRow.product_id === row.productId
        && inventoryChangedFieldsMatch({
          actualRow: finalRow,
          changedFields: row.changedFields,
          expectedRow: row.editedRow,
        });

      return {
        ...row,
        finalRow,
        messages: verified ? row.messages : row.messages.concat("Final-state verification failed"),
        verificationStatus: verified ? "verified" : "failed",
      };
    });

    const outcome = buildBusinessOutcome(verifiedRows);
    const summary = buildInventorySummary(verifiedRows);
    const resultPayload = {
      outcome,
      previewDigest: payload.previewDigest,
      previewJobId: payload.previewJobId,
      profile: payload.profile,
      rows: verifiedRows,
      snapshotArtifactId: snapshotArtifact.record.id,
      summary,
    };

    await persistJsonArtifact({
      artifactCatalog: catalog,
      artifactKeyPrefix,
      artifactStorage,
      body: resultPayload,
      fileName: "result.json",
      job,
      kind: PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
      metadata: {
        outcome,
        previewDigest: payload.previewDigest,
        previewJobId: payload.previewJobId,
        profile: payload.profile,
        snapshotArtifactId: snapshotArtifact.record.id,
        total: summary.total,
      },
    });

    if (infrastructureError) {
      const errorArtifact = await persistJsonArtifact({
        artifactCatalog: catalog,
        artifactKeyPrefix,
        artifactStorage,
        body: {
          code: infrastructureError?.code ?? "inventory-write-failed",
          message: infrastructureError?.message ?? "inventory write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
          resultOutcome: outcome,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: infrastructureError?.code ?? "inventory-write-failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
          resultOutcome: outcome,
        },
      });
      errorArtifactDescriptor = errorArtifact.descriptor;
      errorArtifactRecord = errorArtifact.record;
      skipErrorArtifactPersistence = true;
      throw infrastructureError;
    }

    return resultPayload;
  } catch (error) {
    if (error instanceof MissingOfflineSessionError) {
      error.code = "missing-offline-session";
    }

    if (skipErrorArtifactPersistence) {
      throw error;
    }

    try {
      const errorArtifact = await persistJsonArtifact({
        artifactCatalog: catalog,
        artifactKeyPrefix,
        artifactStorage,
        body: {
          code: error?.code ?? "inventory-write-failed",
          message: error?.message ?? "inventory write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: error?.code ?? "inventory-write-failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
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
