import {
  PRODUCT_VARIANT_PRICES_EXPORT_PROFILE,
  PRODUCT_VARIANTS_EXPORT_PROFILE,
} from "../domain/products/export-profile.mjs";
import {
  buildProductWriteArtifactKey,
  PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
  PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
  PRODUCT_WRITE_SNAPSHOT_ARTIFACT_KIND,
} from "../domain/products/write-profile.mjs";
import {
  buildProductUpdateInputFromPreviewRow,
  changedFieldsMatch,
  getWritablePreviewRows,
} from "../domain/products/write-rows.mjs";
import { runVariantPriceProductWriteJob } from "./product-write-variant-prices.mjs";
import { runVariantProductWriteJob } from "./product-write-variants.mjs";

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

function isMissingOfflineSessionError(error, MissingOfflineSessionError) {
  return (MissingOfflineSessionError && error instanceof MissingOfflineSessionError)
    || error?.name === "MissingOfflineSessionError"
    || error?.code === "missing-offline-session"
    || error?.message === "missing-offline-session";
}

async function loadDefaultDependencies() {
  const [
    { createPrismaArtifactCatalog },
    { readProductsForPreview },
    { updateProductCoreFields },
    offlineAdminModule,
  ] = await Promise.all([
    import("../domain/artifacts/prisma-artifact-catalog.mjs"),
    import("../platform/shopify/product-preview.server.mjs"),
    import("../platform/shopify/product-write.server.mjs"),
    import("./offline-admin.mjs"),
  ]);

  return {
    createPrismaArtifactCatalog,
    loadOfflineAdminContext: offlineAdminModule.loadOfflineAdminContext,
    MissingOfflineSessionError: offlineAdminModule.MissingOfflineSessionError,
    readProductsForPreview,
    updateProductCoreFields,
  };
}

export async function runProductWriteJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  job,
  prisma,
  readLiveProducts,
  resolveAdminContext,
  updateProduct,
} = {}) {
  if (job?.payload?.profile === PRODUCT_VARIANT_PRICES_EXPORT_PROFILE) {
    return runVariantPriceProductWriteJob({
      artifactCatalog,
      artifactKeyPrefix,
      artifactStorage,
      assertJobLeaseActive,
      job,
      prisma,
      readLiveVariants: readLiveProducts,
      resolveAdminContext,
      updateVariants: updateProduct,
    });
  }

  if (job?.payload?.profile === PRODUCT_VARIANTS_EXPORT_PROFILE) {
    return runVariantProductWriteJob({
      artifactCatalog,
      artifactKeyPrefix,
      artifactStorage,
      assertJobLeaseActive,
      job,
      prisma,
      readLiveVariants: readLiveProducts,
      resolveAdminContext,
      updateVariants: updateProduct,
    });
  }

  const defaultDependencies = artifactCatalog && readLiveProducts && resolveAdminContext && updateProduct
    ? null
    : await loadDefaultDependencies();
  const catalog = artifactCatalog ?? defaultDependencies.createPrismaArtifactCatalog(prisma);
  const readProducts = readLiveProducts ?? defaultDependencies.readProductsForPreview;
  const resolveAdmin = resolveAdminContext ?? defaultDependencies.loadOfflineAdminContext;
  const updateProductCore = updateProduct ?? defaultDependencies.updateProductCoreFields;
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
    const writableRows = getWritablePreviewRows(previewPayload.rows);
    const productIds = writableRows.map((row) => row.productId);

    const { admin } = await resolveAdmin({
      prisma,
      shopDomain: job.shopDomain,
    });

    assertJobLeaseActive();
    const revalidatedRowsByProductId = await readProducts(admin, productIds, {
      assertJobLeaseActive,
    });

    const revalidationFailedRows = writableRows.map((row) => {
      const currentRow = revalidatedRowsByProductId.get(row.productId) ?? null;
      const matchesPreview = changedFieldsMatch({
        actualRow: currentRow,
        changedFields: [
          "handle",
          "title",
          "status",
          "vendor",
          "product_type",
          "tags",
          "body_html",
          "seo_title",
          "seo_description",
          "updated_at",
        ],
        expectedRow: row.currentRow,
      });

      return {
        changedFields: row.changedFields,
        editedRow: row.editedRow,
        finalRow: currentRow,
        messages: matchesPreview ? [] : ["Live Shopify product changed after preview confirmation was requested"],
        mutationStatus: "skipped",
        mutationUserErrors: [],
        preWriteRow: currentRow,
        productId: row.productId,
        verificationStatus: matchesPreview ? "pending" : "revalidation_failed",
      };
    });

    if (revalidationFailedRows.some((row) => row.verificationStatus === "revalidation_failed")) {
      const summary = {
        total: writableRows.length,
      };
      const outcome = "revalidation_failed";
      const resultPayload = {
        outcome,
        previewDigest: payload.previewDigest,
        previewJobId: payload.previewJobId,
        profile: payload.profile,
        rows: revalidationFailedRows,
        snapshotArtifactId: null,
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
      return resultPayload;
    }

    const snapshotPayload = {
      previewDigest: payload.previewDigest,
      previewJobId: payload.previewJobId,
      rows: writableRows.map((row) => ({
        changedFields: row.changedFields,
        editedRow: row.editedRow,
        preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
        previewCurrentRow: row.currentRow,
        productId: row.productId,
      })),
    };

    assertJobLeaseActive();
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
    let mutationInfrastructureError = null;
    let stopAfterRowIndex = null;
    for (const [rowIndex, row] of writableRows.entries()) {
      assertJobLeaseActive();
      const mutation = buildProductUpdateInputFromPreviewRow(row);

      if (!mutation.ok) {
        mutationRows.push({
          changedFields: row.changedFields,
          editedRow: row.editedRow,
          finalRow: revalidatedRowsByProductId.get(row.productId) ?? null,
          messages: mutation.errors,
          mutationStatus: "failed",
          mutationUserErrors: mutation.errors.map((message) => ({ field: [], message })),
          preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
          productId: row.productId,
          verificationStatus: "failed",
        });
        continue;
      }

      try {
        const response = await updateProductCore(admin, mutation.input);
        const mutationFailed = Array.isArray(response.userErrors) && response.userErrors.length > 0;

        mutationRows.push({
          changedFields: row.changedFields,
          editedRow: row.editedRow,
          finalRow: null,
          messages: mutationFailed ? response.userErrors.map((error) => error.message) : [],
          mutationStatus: mutationFailed ? "failed" : "success",
          mutationUserErrors: response.userErrors ?? [],
          preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
          productId: row.productId,
          verificationStatus: mutationFailed ? "failed" : "pending",
        });
      } catch (error) {
        mutationInfrastructureError = error;
        stopAfterRowIndex = rowIndex;
        mutationRows.push({
          changedFields: row.changedFields,
          editedRow: row.editedRow,
          finalRow: null,
          messages: [error instanceof Error ? error.message : "product write failed"],
          mutationStatus: "failed",
          mutationUserErrors: [],
          preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
          productId: row.productId,
          verificationStatus: "pending",
        });
        break;
      }
    }

    if (stopAfterRowIndex !== null) {
      for (const row of writableRows.slice(stopAfterRowIndex + 1)) {
        mutationRows.push({
          changedFields: row.changedFields,
          editedRow: row.editedRow,
          finalRow: null,
          messages: ["Write stopped after an earlier infrastructure failure"],
          mutationStatus: "skipped",
          mutationUserErrors: [],
          preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
          productId: row.productId,
          verificationStatus: "skipped",
        });
      }
    }

    assertJobLeaseActive();
    const finalRowsByProductId = await readProducts(admin, productIds, {
      assertJobLeaseActive,
    });

    const verifiedRows = mutationRows.map((row) => {
      const finalRow = finalRowsByProductId.get(row.productId) ?? null;
      if (row.verificationStatus === "skipped") {
        return {
          ...row,
          finalRow,
        };
      }

      const verified = changedFieldsMatch({
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
    const summary = {
      total: writableRows.length,
      verifiedSuccess: verifiedRows.filter((row) => row.verificationStatus === "verified").length,
    };
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

    if (mutationInfrastructureError) {
      const error = mutationInfrastructureError;
      const errorArtifact = await persistJsonArtifact({
        artifactCatalog: catalog,
        artifactKeyPrefix,
        artifactStorage,
        body: {
          code: error?.code ?? "product-write-failed",
          message: error?.message ?? "product write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
          resultOutcome: outcome,
          snapshotArtifactId: snapshotArtifact.record.id,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: error?.code ?? "product-write-failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
          resultOutcome: outcome,
          snapshotArtifactId: snapshotArtifact.record.id,
        },
      });
      errorArtifactDescriptor = errorArtifact.descriptor;
      errorArtifactRecord = errorArtifact.record;
      skipErrorArtifactPersistence = true;
      throw error;
    }

    return resultPayload;
  } catch (error) {
    if (isMissingOfflineSessionError(error, defaultDependencies?.MissingOfflineSessionError)) {
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
          code: error?.code ?? "product-write-failed",
          message: error?.message ?? "product write failed",
          previewJobId: job.payload?.previewJobId ?? null,
          profile: job.payload?.profile ?? null,
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: error?.code ?? "product-write-failed",
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
