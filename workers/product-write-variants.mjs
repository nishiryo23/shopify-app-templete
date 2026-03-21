import { createPrismaArtifactCatalog } from "../domain/artifacts/prisma-artifact-catalog.mjs";
import {
  buildProductWriteArtifactKey,
  PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
  PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
  PRODUCT_WRITE_SNAPSHOT_ARTIFACT_KIND,
} from "../domain/products/write-profile.mjs";
import {
  buildVariantMutationFromPreviewRow,
  buildVariantOptionTuple,
  buildVariantSummary,
  getWritableVariantPreviewRows,
  variantChangedFieldsMatch,
  variantRowsMatch,
} from "../domain/variants/write-rows.mjs";
import {
  createVariantsBulk,
  deleteVariantBulk,
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

function buildRevalidationFailedResult({
  payload,
  rows,
}) {
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

function createRowMatchesCurrentProductSchema(row, currentProduct) {
  const optionsByPosition = new Map(
    (currentProduct?.options ?? []).map((option) => [Number(option.position), option?.name ?? ""]),
  );

  for (let index = 1; index <= 3; index += 1) {
    const editedOptionName = row?.editedRow?.[`option${index}_name`] ?? "";
    const editedOptionValue = row?.editedRow?.[`option${index}_value`] ?? "";
    const currentOptionName = optionsByPosition.get(index) ?? "";

    if (!editedOptionName && !editedOptionValue) {
      continue;
    }

    if (!currentOptionName || editedOptionName !== currentOptionName) {
      return false;
    }
  }

  return true;
}

export async function runVariantProductWriteJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  job,
  prisma,
  createVariants = createVariantsBulk,
  deleteVariant = deleteVariantBulk,
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
    const writableRows = getWritableVariantPreviewRows(previewPayload.rows);
    const productIds = [...new Set(writableRows.map((row) => row.productId).filter(Boolean))];
    const { admin } = await resolveAdminContext({
      prisma,
      shopDomain: job.shopDomain,
    });

    assertJobLeaseActive();
    const {
      productsById: revalidatedProductsById,
      variantsByProductId: revalidatedVariantsByProductId,
    } = await readLiveVariants(admin, productIds, { assertJobLeaseActive });

    const revalidationRows = writableRows.map((row) => {
      const currentProduct = revalidatedProductsById.get(row.productId) ?? null;
      const currentVariants = revalidatedVariantsByProductId.get(row.productId) ?? [];
      const currentRow = row.variantId
        ? (currentVariants.find((variant) => variant.variant_id === row.variantId) ?? null)
        : null;
      const duplicateLive = currentVariants.find(
        (variant) => buildVariantOptionTuple(variant) === buildVariantOptionTuple(row.editedRow),
      );
      const matchesPreview = row.operation === "create"
        ? Boolean(currentProduct) && createRowMatchesCurrentProductSchema(row, currentProduct) && !duplicateLive
        : variantRowsMatch(currentRow, row.currentRow);

      return {
        changedFields: row.changedFields,
        createdVariantId: null,
        editedRow: row.editedRow,
        editedRowNumber: row.editedRowNumber,
        finalRow: currentRow,
        messages: matchesPreview ? [] : ["プレビュー確定後に、Shopify 上の最新のバリエーションが変更されました"],
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
      const createRows = rows.filter((row) => row.operation === "create");
      const updateRows = rows.filter((row) => row.operation === "update");
      const deleteRows = rows.filter((row) => row.operation === "delete");

      for (let index = 0; index < createRows.length; index += 250) {
        assertJobLeaseActive();
        const chunkRows = createRows.slice(index, index + 250);
        const chunkInputs = [];
        const inputRows = [];

        for (const row of chunkRows) {
          const mutation = buildVariantMutationFromPreviewRow(row);
          if (!mutation.ok) {
            mutationRows.push({
              changedFields: row.changedFields,
              createdVariantId: null,
              editedRow: row.editedRow,
              editedRowNumber: row.editedRowNumber,
              finalRow: null,
              messages: mutation.errors,
              mutationStatus: "failed",
              mutationUserErrors: mutation.errors.map((message) => ({ field: [], message })),
              operation: row.operation,
              preWriteRow: null,
              productId,
              variantId: null,
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
          const response = await createVariants(admin, {
            productId,
            variants: chunkInputs,
          });
          const errorsByIndex = buildUserErrorMap(response.userErrors);
          let createdIndex = 0;

          for (let rowIndex = 0; rowIndex < inputRows.length; rowIndex += 1) {
            const row = inputRows[rowIndex];
            const rowErrors = errorsByIndex.get(rowIndex) ?? [];
            const mutationFailed = rowErrors.length > 0 || (
              errorsByIndex.size === 0
              && Array.isArray(response.userErrors)
              && response.userErrors.length > 0
            );
            const createdVariantId = mutationFailed
              ? null
              : response.productVariants?.[createdIndex]?.id ?? null;
            if (!mutationFailed) {
              createdIndex += 1;
            }

            mutationRows.push({
              changedFields: row.changedFields,
              createdVariantId,
              editedRow: row.editedRow,
              editedRowNumber: row.editedRowNumber,
              finalRow: null,
              messages: mutationFailed ? (rowErrors.length > 0
                ? rowErrors.map((error) => error.message)
                : response.userErrors.map((error) => error.message)) : [],
              mutationStatus: mutationFailed ? "failed" : "success",
              mutationUserErrors: mutationFailed ? (rowErrors.length > 0 ? rowErrors : response.userErrors) : [],
              operation: row.operation,
              preWriteRow: null,
              productId,
              variantId: null,
              verificationStatus: mutationFailed ? "failed" : "pending",
            });
          }
        } catch (error) {
          infrastructureError = error;
          for (const row of inputRows) {
            mutationRows.push({
              changedFields: row.changedFields,
              createdVariantId: null,
              editedRow: row.editedRow,
              editedRowNumber: row.editedRowNumber,
              finalRow: null,
              messages: [error instanceof Error ? error.message : "variant create failed"],
              mutationStatus: "failed",
              mutationUserErrors: [],
              operation: row.operation,
              preWriteRow: null,
              productId,
              variantId: null,
              verificationStatus: "pending",
            });
          }
          break;
        }
      }

      if (infrastructureError) {
        break;
      }

      for (let index = 0; index < updateRows.length; index += 250) {
        assertJobLeaseActive();
        const chunkRows = updateRows.slice(index, index + 250);
        const chunkInputs = [];
        const inputRows = [];

        for (const row of chunkRows) {
          const mutation = buildVariantMutationFromPreviewRow(row);
          if (!mutation.ok) {
            mutationRows.push({
              changedFields: row.changedFields,
              createdVariantId: null,
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
              createdVariantId: null,
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
              createdVariantId: null,
              editedRow: row.editedRow,
              editedRowNumber: row.editedRowNumber,
              finalRow: null,
              messages: [error instanceof Error ? error.message : "variant update failed"],
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

      for (const row of deleteRows) {
        assertJobLeaseActive();
        try {
          const response = await deleteVariant(admin, {
            productId,
            variantId: row.variantId,
          });
          const mutationFailed = Array.isArray(response.userErrors) && response.userErrors.length > 0;
          mutationRows.push({
            changedFields: row.changedFields,
            createdVariantId: null,
            editedRow: row.editedRow,
            editedRowNumber: row.editedRowNumber,
            finalRow: null,
            messages: mutationFailed ? response.userErrors.map((error) => error.message) : [],
            mutationStatus: mutationFailed ? "failed" : "success",
            mutationUserErrors: response.userErrors ?? [],
            operation: row.operation,
            preWriteRow: row.currentRow,
            productId,
            variantId: row.variantId,
            verificationStatus: mutationFailed ? "failed" : "pending",
          });
        } catch (error) {
          infrastructureError = error;
          mutationRows.push({
            changedFields: row.changedFields,
            createdVariantId: null,
            editedRow: row.editedRow,
            editedRowNumber: row.editedRowNumber,
            finalRow: null,
            messages: [error instanceof Error ? error.message : "variant delete failed"],
            mutationStatus: "failed",
            mutationUserErrors: [],
            operation: row.operation,
            preWriteRow: row.currentRow,
            productId,
            variantId: row.variantId,
            verificationStatus: "pending",
          });
          break;
        }
      }

      if (infrastructureError) {
        break;
      }
    }

    if (infrastructureError) {
      const processedKeys = new Set(mutationRows.map((row) => row.editedRowNumber));
      for (const row of writableRows) {
        if (processedKeys.has(row.editedRowNumber)) {
          continue;
        }

        mutationRows.push({
          changedFields: row.changedFields,
          createdVariantId: null,
          editedRow: row.editedRow,
          editedRowNumber: row.editedRowNumber,
          finalRow: null,
          messages: ["Write stopped after an earlier infrastructure failure"],
          mutationStatus: "skipped",
          mutationUserErrors: [],
          operation: row.operation,
          preWriteRow: row.currentRow,
          productId: row.productId,
          variantId: row.variantId,
          verificationStatus: "skipped",
        });
      }
    }

    assertJobLeaseActive();
    const {
      variantsByProductId: finalVariantsByProductId,
    } = await readLiveVariants(admin, productIds, { assertJobLeaseActive });

    const verifiedRows = mutationRows.map((row) => {
      const currentVariants = finalVariantsByProductId.get(row.productId) ?? [];
      const finalRow = row.createdVariantId
        ? currentVariants.find((variant) => variant.variant_id === row.createdVariantId) ?? null
        : row.variantId
          ? currentVariants.find((variant) => variant.variant_id === row.variantId) ?? null
          : currentVariants.find((variant) => buildVariantOptionTuple(variant) === buildVariantOptionTuple(row.editedRow)) ?? null;

      if (row.verificationStatus === "skipped" || row.verificationStatus === "failed") {
        return {
          ...row,
          finalRow,
        };
      }

      let verified = false;
      if (row.operation === "delete") {
        verified = !finalRow;
      } else {
        verified = Boolean(finalRow) && variantChangedFieldsMatch({
          actualRow: finalRow,
          changedFields: row.changedFields,
          expectedRow: row.editedRow,
        });
      }

      return {
        ...row,
        finalRow,
        messages: verified ? row.messages : row.messages.concat("Final-state verification failed"),
        verificationStatus: verified ? "verified" : "failed",
      };
    });

    const outcome = buildBusinessOutcome(verifiedRows);
    const summary = buildVariantSummary(verifiedRows);
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
          code: infrastructureError?.code ?? "variant-write-failed",
          message: infrastructureError?.message ?? "variant write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
          resultOutcome: outcome,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: infrastructureError?.code ?? "variant-write-failed",
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
          code: error?.code ?? "variant-write-failed",
          message: error?.message ?? "variant write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: error?.code ?? "variant-write-failed",
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
