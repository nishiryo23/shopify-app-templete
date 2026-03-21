import { createPrismaArtifactCatalog } from "../domain/artifacts/prisma-artifact-catalog.mjs";
import {
  buildProductWriteArtifactKey,
  PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
  PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
  PRODUCT_WRITE_SNAPSHOT_ARTIFACT_KIND,
} from "../domain/products/write-profile.mjs";
import {
  buildMediaCreateInputFromPreviewRow,
  buildMediaDeleteInputFromPreviewRow,
  buildMediaReorderMovesForProduct,
  buildMediaSummary,
  buildMediaUpdateInputFromPreviewRow,
  getWritableMediaPreviewRows,
  mediaChangedFieldsMatch,
} from "../domain/media/write-rows.mjs";
import {
  createProductMedia,
  deleteProductMedia,
  readMediaForProducts,
  readProductMediaJob,
  reorderProductMedia,
  updateProductMedia,
} from "../platform/shopify/product-media.server.mjs";
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
  return `${row?.productId ?? row?.product_id ?? ""}\u001e${row?.mediaId ?? row?.media_id ?? ""}`;
}

function buildExpectedEditedRowForVerification(row) {
  if (row?.operation !== "replace") {
    return row?.editedRow ?? {};
  }

  const editedPosition = (row?.editedRow?.image_position ?? "").trim();
  if (editedPosition) {
    return row?.editedRow ?? {};
  }

  return {
    ...(row?.editedRow ?? {}),
    image_position: row?.preWriteRow?.image_position ?? row?.currentRow?.image_position ?? "",
  };
}

function buildVerificationChangedFields(row) {
  const changedFields = Array.isArray(row?.changedFields) ? [...row.changedFields] : [];
  const expectedRow = buildExpectedEditedRowForVerification(row);

  if (
    (row?.operation === "create" || row?.operation === "replace")
    && !changedFields.includes("image_alt")
  ) {
    changedFields.push("image_alt");
  }

  if (
    row?.operation === "replace"
    && (expectedRow.image_position ?? "") !== ""
    && !changedFields.includes("image_position")
  ) {
    changedFields.push("image_position");
  }

  return changedFields;
}

function buildMediaSetEntryKey(row) {
  return `${row?.product_id ?? ""}\u001e${row?.media_id ?? ""}`;
}

function buildLegacyImageMediaSetByProductFromPreviewRows(rows) {
  const mediaSetByProduct = new Map();

  for (const row of rows ?? []) {
    const productId = row?.productId ?? row?.currentRow?.product_id ?? row?.editedRow?.product_id ?? null;
    if (!productId) {
      continue;
    }

    let mediaSet = mediaSetByProduct.get(productId);
    if (!mediaSet) {
      mediaSet = [];
      mediaSetByProduct.set(productId, mediaSet);
    }

    if (row?.currentRow?.media_id) {
      mediaSet.push({
        image_alt: row.currentRow.image_alt ?? "",
        image_position: row.currentRow.image_position ?? "",
        image_src: row.currentRow.image_src ?? "",
        media_content_type: "IMAGE",
        media_id: row.currentRow.media_id,
        product_id: productId,
      });
    }
  }

  return mediaSetByProduct;
}

function buildLegacyImageMediaSetByProductFromLiveRows(rowsByKey) {
  const mediaSetByProduct = new Map();

  for (const row of rowsByKey?.values?.() ?? []) {
    const productId = row?.product_id ?? null;
    if (!productId || !row?.media_id) {
      continue;
    }

    let mediaSet = mediaSetByProduct.get(productId);
    if (!mediaSet) {
      mediaSet = [];
      mediaSetByProduct.set(productId, mediaSet);
    }

    mediaSet.push({
      image_alt: row.image_alt ?? "",
      image_position: row.image_position ?? "",
      image_src: row.image_src ?? "",
      media_content_type: "IMAGE",
      media_id: row.media_id,
      product_id: productId,
    });
  }

  return mediaSetByProduct;
}

function buildMediaSetByProductFromPreviewPayload(mediaSetByProduct) {
  const normalized = new Map();

  for (const [productId, mediaSet] of Object.entries(mediaSetByProduct ?? {})) {
    if (!productId || !Array.isArray(mediaSet)) {
      continue;
    }

    normalized.set(productId, mediaSet);
  }

  return normalized;
}

function mediaSetContainsOnlyImages(mediaSet) {
  return Array.isArray(mediaSet) && mediaSet.every((row) => (row?.media_content_type ?? "") === "IMAGE");
}

function productMediaSetMatchesPreview(expectedRows, actualRows) {
  const expected = Array.isArray(expectedRows) ? expectedRows : null;
  const actual = Array.isArray(actualRows) ? actualRows : null;

  if (!expected || !actual) {
    return false;
  }

  if (expected.length !== actual.length) {
    return false;
  }

  const actualByKey = new Map(actual.map((row) => [buildMediaSetEntryKey(row), row]));

  for (const expectedRow of expected) {
    const actualRow = actualByKey.get(buildMediaSetEntryKey(expectedRow));
    if (!actualRow) {
      return false;
    }

    if (
      (actualRow.product_id ?? "") !== (expectedRow.product_id ?? "")
      || (actualRow.media_id ?? "") !== (expectedRow.media_id ?? "")
      || (actualRow.image_alt ?? "") !== (expectedRow.image_alt ?? "")
      || (actualRow.image_position ?? "") !== (expectedRow.image_position ?? "")
      || (actualRow.image_src ?? "") !== (expectedRow.image_src ?? "")
    ) {
      return false;
    }
  }

  return true;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function rollbackCreatedMedia(admin, { createdMediaId, productId }) {
  if (!createdMediaId || !productId) {
    return [];
  }

  const rollbackResponse = await deleteProductMedia(admin, {
    mediaIds: [createdMediaId],
    productId,
  });

  return Array.isArray(rollbackResponse.userErrors) ? rollbackResponse.userErrors : [];
}

async function waitForMediaJobCompletion(
  admin,
  {
    assertJobLeaseActive = () => {},
    jobId,
    maxAttempts = 10,
    pollIntervalMs = 1000,
    readMediaJob = readProductMediaJob,
    sleep = delay,
  } = {},
) {
  if (!jobId) {
    return null;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    assertJobLeaseActive();
    const job = await readMediaJob(admin, { jobId });
    if (!job || job.done) {
      return job;
    }

    if (attempt < maxAttempts - 1) {
      await sleep(pollIntervalMs);
    }
  }

  throw new Error(`media reorder job did not complete: ${jobId}`);
}

async function waitForCreatedMediaVisibility(
  admin,
  {
    assertJobLeaseActive = () => {},
    createdRows = [],
    maxAttempts = 10,
    pollIntervalMs = 1000,
    productIds = [],
    readLiveMedia = readMediaForProducts,
    sleep = delay,
  } = {},
) {
  if (productIds.length === 0) {
    return { rowsByKey: new Map() };
  }

  if (createdRows.length === 0) {
    return readLiveMedia(admin, productIds, { assertJobLeaseActive });
  }

  const pendingKeys = new Set(
    createdRows
      .map((row) => buildRowKey(row))
      .filter(Boolean),
  );

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    assertJobLeaseActive();
    const finalState = await readLiveMedia(admin, productIds, { assertJobLeaseActive });

    for (const key of pendingKeys) {
      if (finalState.rowsByKey.has(key)) {
        pendingKeys.delete(key);
      }
    }

    if (pendingKeys.size === 0) {
      return finalState;
    }

    if (attempt < maxAttempts - 1) {
      await sleep(pollIntervalMs);
    }
  }

  return readLiveMedia(admin, productIds, { assertJobLeaseActive });
}

async function executeMutation(admin, row) {
  if (row.operation === "create" || row.operation === "replace") {
    const createInput = buildMediaCreateInputFromPreviewRow(row);
    if (!createInput.ok) {
      return { errors: createInput.errors, ok: false };
    }

    const response = await createProductMedia(admin, {
      media: [{
        alt: createInput.input.alt,
        mediaContentType: createInput.input.mediaContentType,
        originalSource: createInput.input.originalSource,
      }],
      productId: createInput.input.productId,
    });

    const createFailed = Array.isArray(response.userErrors) && response.userErrors.length > 0;
    if (createFailed) {
      return {
        ok: true,
        response,
      };
    }

    if (row.operation === "replace" && row.mediaId) {
      const deleteResult = buildMediaDeleteInputFromPreviewRow(row);
      if (!deleteResult.ok) {
        return { errors: deleteResult.errors, ok: false };
      }

      const createdMediaId = response.media?.[0]?.id ?? null;

      try {
        const deleteResponse = await deleteProductMedia(admin, deleteResult.input);
        if (Array.isArray(deleteResponse.userErrors) && deleteResponse.userErrors.length > 0) {
          let rollbackUserErrors = [];
          if (createdMediaId) {
            rollbackUserErrors = await rollbackCreatedMedia(admin, {
              createdMediaId,
              productId: row.productId,
            });
          }

          return {
            ok: true,
            response: {
              media: response.media,
              userErrors: deleteResponse.userErrors.concat(rollbackUserErrors),
            },
          };
        }
      } catch (error) {
        if (createdMediaId) {
          await rollbackCreatedMedia(admin, {
            createdMediaId,
            productId: row.productId,
          });
        }
        throw error;
      }
    }

    return {
      createdMediaId: response.media?.[0]?.id ?? null,
      createdMediaStatus: response.media?.[0]?.status ?? null,
      ok: true,
      response,
    };
  }

  if (row.operation === "delete") {
    const deleteInput = buildMediaDeleteInputFromPreviewRow(row);
    if (!deleteInput.ok) {
      return { errors: deleteInput.errors, ok: false };
    }

    const response = await deleteProductMedia(admin, deleteInput.input);

    return {
      ok: true,
      response: {
        media: [],
        userErrors: response.userErrors,
      },
    };
  }

  const updateInput = buildMediaUpdateInputFromPreviewRow(row);
  if (!updateInput.ok) {
    return { errors: updateInput.errors, ok: false };
  }

  if (!updateInput.input) {
    return {
      ok: true,
      response: {
        media: [],
        userErrors: [],
      },
    };
  }

  const response = await updateProductMedia(admin, {
    media: [updateInput.input],
    productId: row.productId,
  });

  return {
    ok: true,
    response,
  };
}

export async function runMediaProductWriteJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  job,
  mediaCreatePollIntervalMs = 1000,
  mediaCreatePollMaxAttempts = 10,
  mediaJobPollIntervalMs = 1000,
  mediaJobPollMaxAttempts = 10,
  prisma,
  readLiveMedia = readMediaForProducts,
  readMediaJob = readProductMediaJob,
  resolveAdminContext = loadOfflineAdminContext,
  sleep = delay,
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
    const writableRows = getWritableMediaPreviewRows(previewPayload.rows);

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
      mediaSetByProduct: revalidatedMediaSetByProduct,
      rowsByKey: revalidatedRowsByKey,
    } = await readLiveMedia(admin, productIds, { assertJobLeaseActive });
    const previewMediaSetByProduct = buildMediaSetByProductFromPreviewPayload(previewPayload.mediaSetByProduct);
    const legacyPreviewMediaSetByProduct = buildLegacyImageMediaSetByProductFromPreviewRows(previewPayload.rows);
    const legacyLiveMediaSetByProduct = buildLegacyImageMediaSetByProductFromLiveRows(revalidatedRowsByKey);

    const revalidationRows = writableRows.map((row) => {
      const key = buildRowKey(row);
      const currentRow = row.operation === "create" ? null : (revalidatedRowsByKey.get(key) ?? null);
      const requiresProductSetRevalidation = row.operation === "create"
        || row.operation === "replace"
        || row.changedFields?.includes("image_position");
      const actualMediaSet = revalidatedMediaSetByProduct?.get(row.productId)
        ?? legacyLiveMediaSetByProduct.get(row.productId)
        ?? [];
      const expectedMediaSet = previewMediaSetByProduct.get(row.productId)
        ?? (mediaSetContainsOnlyImages(actualMediaSet) ? legacyPreviewMediaSetByProduct.get(row.productId) ?? [] : null);
      const matchesPreview = requiresProductSetRevalidation
        ? productMediaSetMatchesPreview(
          expectedMediaSet,
          actualMediaSet,
        )
        : (
          Boolean(currentRow)
          && currentRow.product_id === row.productId
          && (currentRow.image_alt ?? "") === (row.currentRow?.image_alt ?? "")
          && (currentRow.image_position ?? "") === (row.currentRow?.image_position ?? "")
          && (currentRow.image_src ?? "") === (row.currentRow?.image_src ?? "")
        );

      return {
        changedFields: row.changedFields,
        currentRow,
        editedRow: row.editedRow,
        editedRowNumber: row.editedRowNumber,
        finalRow: currentRow,
        mediaId: row.mediaId,
        messages: matchesPreview
          ? []
          : [requiresProductSetRevalidation && !expectedMediaSet
              ? "メディアの再確認に必要なプレビュー情報が不足しています"
              : "プレビュー確定後に、Shopify 上の最新のメディアが変更されました"],
        mutationStatus: "skipped",
        mutationUserErrors: [],
        operation: row.operation,
        preWriteRow: currentRow,
        productId: row.productId,
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
        mediaId: row.mediaId,
        operation: row.operation,
        preWriteRow: row.preWriteRow,
        productId: row.productId,
      })),
    };

    await persistJsonArtifact({
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

    for (const row of revalidationRows) {
      assertJobLeaseActive();

      try {
        const result = await executeMutation(admin, row);

        if (!result.ok) {
          mutationRows.push({
            changedFields: row.changedFields,
            currentRow: row.currentRow,
            createdMediaId: null,
            createdMediaStatus: null,
            editedRow: row.editedRow,
            editedRowNumber: row.editedRowNumber,
            finalRow: null,
            mediaId: row.mediaId,
            messages: result.errors,
            mutationStatus: "failed",
            mutationUserErrors: result.errors.map((message) => ({ field: [], message })),
            operation: row.operation,
            originalMediaId: row.mediaId,
            preWriteRow: row.preWriteRow,
            productId: row.productId,
            verificationStatus: "failed",
          });
          continue;
        }

        const mutationFailed = Array.isArray(result.response.userErrors) && result.response.userErrors.length > 0;

        mutationRows.push({
          changedFields: row.changedFields,
          currentRow: row.currentRow,
          createdMediaId: result.createdMediaId ?? null,
          createdMediaStatus: result.createdMediaStatus ?? null,
          editedRow: row.editedRow,
          editedRowNumber: row.editedRowNumber,
          finalRow: null,
          mediaId: result.createdMediaId ?? row.mediaId,
          messages: mutationFailed ? result.response.userErrors.map((error) => error.message) : [],
          mutationStatus: mutationFailed ? "failed" : "success",
          mutationUserErrors: mutationFailed ? result.response.userErrors : [],
          operation: row.operation,
          originalMediaId: row.mediaId,
          preWriteRow: row.preWriteRow,
          productId: row.productId,
          verificationStatus: mutationFailed ? "failed" : "pending",
        });
      } catch (error) {
        infrastructureError = error;
        mutationRows.push({
          changedFields: row.changedFields,
          currentRow: row.currentRow,
          createdMediaId: null,
          createdMediaStatus: null,
          editedRow: row.editedRow,
          editedRowNumber: row.editedRowNumber,
          finalRow: null,
          mediaId: row.mediaId,
          messages: [error instanceof Error ? error.message : "media write failed"],
          mutationStatus: "failed",
          mutationUserErrors: [],
          operation: row.operation,
          originalMediaId: row.mediaId,
          preWriteRow: row.preWriteRow,
          productId: row.productId,
          verificationStatus: "pending",
        });
        break;
      }
    }

    if (infrastructureError) {
      const remainingRows = revalidationRows.slice(mutationRows.length);
      for (const row of remainingRows) {
        mutationRows.push({
          changedFields: row.changedFields,
          currentRow: row.currentRow,
          createdMediaId: null,
          createdMediaStatus: null,
          editedRow: row.editedRow,
          editedRowNumber: row.editedRowNumber,
          finalRow: null,
          mediaId: row.mediaId,
          messages: ["Write stopped after an earlier infrastructure failure"],
          mutationStatus: "skipped",
          mutationUserErrors: [],
          operation: row.operation,
          originalMediaId: row.mediaId,
          preWriteRow: row.preWriteRow,
          productId: row.productId,
          verificationStatus: "skipped",
        });
      }
    }

    if (!infrastructureError) {
      const productIdsRequiringReorder = new Set(
        mutationRows
          .filter((row) => row.mutationStatus === "success")
          .filter((row) => (
            row.changedFields?.includes("image_position")
            || row.operation === "replace"
          ) && row.productId)
          .map((row) => row.productId),
      );

      for (const pid of productIdsRequiringReorder) {
        assertJobLeaseActive();
        const productRows = mutationRows.filter(
          (row) => row.productId === pid && row.mutationStatus === "success",
        );
        const moves = buildMediaReorderMovesForProduct(productRows);
        if (moves && moves.length > 0) {
          try {
            const reorderResult = await reorderProductMedia(admin, { moves, productId: pid });
            if (Array.isArray(reorderResult.userErrors) && reorderResult.userErrors.length > 0) {
              const messages = reorderResult.userErrors.map((error) => error.message);
              for (const row of productRows.filter(
                (entry) => entry.changedFields?.includes("image_position") || entry.operation === "replace",
              )) {
                row.messages = row.messages.concat(messages);
                row.mutationStatus = "failed";
                row.mutationUserErrors = reorderResult.userErrors;
                row.verificationStatus = "failed";
              }
              continue;
            }

            await waitForMediaJobCompletion(admin, {
              assertJobLeaseActive,
              jobId: reorderResult.job?.id ?? null,
              maxAttempts: mediaJobPollMaxAttempts,
              pollIntervalMs: mediaJobPollIntervalMs,
              readMediaJob,
              sleep,
            });
          } catch (error) {
            infrastructureError = error;
            break;
          }
        }
      }
    }

    const createdRowsRequiringVisibilityWait = mutationRows.filter((row) => {
      if (row.mutationStatus !== "success") {
        return false;
      }

      if ((row.operation !== "create" && row.operation !== "replace") || !row.createdMediaId) {
        return false;
      }

      return row.createdMediaStatus === "UPLOADED" || row.createdMediaStatus === "PROCESSING";
    });

    assertJobLeaseActive();
    const {
      rowsByKey: finalRowsByKey,
    } = await waitForCreatedMediaVisibility(admin, {
      assertJobLeaseActive,
      createdRows: createdRowsRequiringVisibilityWait,
      maxAttempts: mediaCreatePollMaxAttempts,
      pollIntervalMs: mediaCreatePollIntervalMs,
      productIds,
      readLiveMedia,
      sleep,
    });

    const verifiedRows = mutationRows.map((row) => {
      if (row.operation === "delete") {
        const key = buildRowKey(row);
        const finalRow = finalRowsByKey.get(key) ?? null;
        const verified = !finalRow;
        return {
          ...row,
          finalRow: null,
          messages: verified ? row.messages : row.messages.concat("Final-state verification failed: media still exists"),
          verificationStatus: verified ? "verified" : "failed",
        };
      }

      if (row.verificationStatus === "skipped" || row.verificationStatus === "failed") {
        const key = buildRowKey(row);
        const finalRow = key ? (finalRowsByKey.get(key) ?? null) : null;
        return {
          ...row,
          finalRow,
        };
      }

      if (row.operation === "create" || row.operation === "replace") {
        if (row.mutationStatus !== "success") {
          const key = buildRowKey(row);
          const finalRow = key ? (finalRowsByKey.get(key) ?? null) : null;
          return {
            ...row,
            finalRow,
            verificationStatus: row.verificationStatus,
          };
        }

        const key = buildRowKey(row);
        const finalRow = key ? (finalRowsByKey.get(key) ?? null) : null;
        const replacedRowStillExists = row.operation === "replace" && row.originalMediaId
          ? finalRowsByKey.has(`${row.productId}\u001e${row.originalMediaId}`)
          : false;
        const verificationChangedFields = buildVerificationChangedFields(row);
        const expectedRow = buildExpectedEditedRowForVerification(row);
        const verified = Boolean(finalRow)
          && finalRow.product_id === row.productId
          && !replacedRowStillExists
          && mediaChangedFieldsMatch({
            actualRow: finalRow,
            changedFields: verificationChangedFields,
            expectedRow,
          });

        return {
          ...row,
          finalRow,
          messages: verified ? row.messages : row.messages.concat("Final-state verification failed"),
          verificationStatus: verified ? "verified" : "failed",
        };
      }

      const key = buildRowKey(row);
      const finalRow = finalRowsByKey.get(key) ?? null;

      const verified = Boolean(finalRow)
        && finalRow.product_id === row.productId
        && mediaChangedFieldsMatch({
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
    const summary = buildMediaSummary(verifiedRows);
    const resultPayload = {
      outcome,
      previewDigest: payload.previewDigest,
      previewJobId: payload.previewJobId,
      profile: payload.profile,
      rows: verifiedRows,
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
          code: infrastructureError?.code ?? "media-write-failed",
          message: infrastructureError?.message ?? "media write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
          resultOutcome: outcome,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: infrastructureError?.code ?? "media-write-failed",
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
          code: error?.code ?? "media-write-failed",
          message: error?.message ?? "media write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: error?.code ?? "media-write-failed",
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
