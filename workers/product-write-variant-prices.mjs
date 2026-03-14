import { createPrismaArtifactCatalog } from "../domain/artifacts/prisma-artifact-catalog.mjs";
import {
  buildProductWriteArtifactKey,
  PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
  PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
  PRODUCT_WRITE_SNAPSHOT_ARTIFACT_KIND,
} from "../domain/products/write-profile.mjs";
import {
  buildVariantPriceMutationFromPreviewRow,
  buildVariantPriceSummary,
  getWritableVariantPricePreviewRows,
  variantPriceChangedFieldsMatch,
  variantPriceRowsMatch,
} from "../domain/variant-prices/write-rows.mjs";
import {
  readVariantsForProducts,
  updateVariantsBulk,
} from "../platform/shopify/product-variants.server.mjs";
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

export async function runVariantPriceProductWriteJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  job,
  prisma,
  readLiveVariants = readVariantsForProducts,
  resolveAdminContext = loadOfflineAdminContext,
  updateVariants = updateVariantsBulk,
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
    const writableRows = getWritableVariantPricePreviewRows(previewPayload.rows);
    const productIds = [...new Set(writableRows.map((row) => row.productId).filter(Boolean))];
    const { admin } = await resolveAdminContext({
      prisma,
      shopDomain: job.shopDomain,
    });

    assertJobLeaseActive();
    const {
      variantsByProductId: revalidatedVariantsByProductId,
    } = await readLiveVariants(admin, productIds, { assertJobLeaseActive });

    const revalidationRows = writableRows.map((row) => {
      const currentVariants = revalidatedVariantsByProductId.get(row.productId) ?? [];
      const currentRow = row.variantId
        ? (currentVariants.find((variant) => variant.variant_id === row.variantId) ?? null)
        : null;
      const matchesPreview = Boolean(currentRow)
        && currentRow.product_id === row.productId
        && variantPriceRowsMatch(currentRow, row.currentRow);

      return {
        changedFields: row.changedFields,
        editedRow: row.editedRow,
        editedRowNumber: row.editedRowNumber,
        finalRow: currentRow,
        messages: matchesPreview ? [] : ["Live Shopify variant changed after preview confirmation was requested"],
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
      rows: writableRows.map((row) => ({
        changedFields: row.changedFields,
        currentRow: row.currentRow,
        editedRow: row.editedRow,
        editedRowNumber: row.editedRowNumber,
        operation: row.operation,
        preWriteRow: row.variantId
          ? (revalidatedVariantsByProductId.get(row.productId) ?? []).find((variant) => variant.variant_id === row.variantId) ?? null
          : null,
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
    const rowsByProductId = new Map();
    for (const row of writableRows) {
      const current = rowsByProductId.get(row.productId) ?? [];
      current.push(row);
      rowsByProductId.set(row.productId, current);
    }

    for (const [productId, rows] of rowsByProductId.entries()) {
      for (let index = 0; index < rows.length; index += 250) {
        assertJobLeaseActive();
        const chunkRows = rows.slice(index, index + 250);
        const chunkInputs = [];
        const inputRows = [];

        for (const row of chunkRows) {
          const mutation = buildVariantPriceMutationFromPreviewRow(row);
          if (!mutation.ok) {
            mutationRows.push({
              changedFields: row.changedFields,
              editedRow: row.editedRow,
              editedRowNumber: row.editedRowNumber,
              finalRow: null,
              messages: mutation.errors,
              mutationStatus: "failed",
              mutationUserErrors: mutation.errors.map((message) => ({ field: [], message })),
              operation: row.operation,
              preWriteRow: row.currentRow,
              productId,
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
          const response = await updateVariants(admin, {
            productId,
            variants: chunkInputs,
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
              editedRow: row.editedRow,
              editedRowNumber: row.editedRowNumber,
              finalRow: null,
              messages: mutationFailed ? (rowErrors.length > 0
                ? rowErrors.map((error) => error.message)
                : response.userErrors.map((error) => error.message)) : [],
              mutationStatus: mutationFailed ? "failed" : "success",
              mutationUserErrors: mutationFailed ? (rowErrors.length > 0 ? rowErrors : response.userErrors) : [],
              operation: row.operation,
              preWriteRow: row.currentRow,
              productId,
              variantId: row.variantId,
              verificationStatus: mutationFailed ? "failed" : "pending",
            });
          }
        } catch (error) {
          infrastructureError = error;
          for (const row of inputRows) {
            mutationRows.push({
              changedFields: row.changedFields,
              editedRow: row.editedRow,
              editedRowNumber: row.editedRowNumber,
              finalRow: null,
              messages: [error instanceof Error ? error.message : "variant price update failed"],
              mutationStatus: "failed",
              mutationUserErrors: [],
              operation: row.operation,
              preWriteRow: row.currentRow,
              productId,
              variantId: row.variantId,
              verificationStatus: "pending",
            });
          }
          break;
        }
      }

      if (infrastructureError) {
        break;
      }
    }

    assertJobLeaseActive();
    const {
      variantsByProductId: finalVariantsByProductId,
    } = await readLiveVariants(admin, productIds, { assertJobLeaseActive });

    const verifiedRows = mutationRows.map((row) => {
      const currentVariants = finalVariantsByProductId.get(row.productId) ?? [];
      const finalRow = row.variantId
        ? currentVariants.find((variant) => variant.variant_id === row.variantId) ?? null
        : null;

      if (row.verificationStatus === "skipped" || row.verificationStatus === "failed") {
        return {
          ...row,
          finalRow,
        };
      }

      const verified = Boolean(finalRow)
        && finalRow.product_id === row.productId
        && variantPriceChangedFieldsMatch({
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
    const summary = buildVariantPriceSummary(verifiedRows);
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
        total: summary.total,
      },
    });

    if (infrastructureError) {
      const errorArtifact = await persistJsonArtifact({
        artifactCatalog: catalog,
        artifactKeyPrefix,
        artifactStorage,
        body: {
          code: infrastructureError?.code ?? "variant-price-write-failed",
          message: infrastructureError?.message ?? "variant price write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
          resultOutcome: outcome,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: infrastructureError?.code ?? "variant-price-write-failed",
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
          code: error?.code ?? "variant-price-write-failed",
          message: error?.message ?? "variant price write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: error?.code ?? "variant-price-write-failed",
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
