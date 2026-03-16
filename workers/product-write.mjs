import {
  PRODUCT_INVENTORY_EXPORT_PROFILE,
  PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE,
  PRODUCT_METAFIELDS_EXPORT_PROFILE,
  PRODUCT_MEDIA_EXPORT_PROFILE,
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
import {
  buildHandleRedirectMetadata,
  buildRedirectLookupKey,
  isHandleChangedFieldSet,
  normalizeProductHandle,
  removeAlreadyAppliedHandleField,
} from "../domain/products/redirects.mjs";
import { readRedirectsByPaths } from "../platform/shopify/product-redirects.server.mjs";
import { runInventoryProductWriteJob } from "./product-write-inventory.mjs";
import { runMetafieldProductWriteJob } from "./product-write-metafields.mjs";
import { runMediaProductWriteJob } from "./product-write-media.mjs";
import { runCollectionProductWriteJob } from "./product-write-collections.mjs";
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

function buildBusinessOutcome(rows, { rollbackableRowCount = 0 } = {}) {
  const successCount = rows.filter((row) => row.verificationStatus === "verified").length;
  const failureCount = rows.length - successCount;

  if (failureCount === 0) {
    return "verified_success";
  }

  if (successCount === 0) {
    if (rollbackableRowCount > 0) {
      return "partial_failure";
    }
    return "verified_failure";
  }

  return "partial_failure";
}

function collectHandleChangeRedirectPaths(rows) {
  return rows
    .filter((row) => isHandleChangedFieldSet(row.changedFields) && row.redirectPath)
    .map((row) => row.redirectPath);
}

function buildRedirectLookup(redirectsByPath) {
  const lookup = new Map();
  for (const [path, redirects] of redirectsByPath.entries()) {
    for (const redirect of redirects ?? []) {
      lookup.set(buildRedirectLookupKey({ path, target: redirect.target }), redirect);
    }
  }
  return lookup;
}

function hydrateHandleRedirectMetadata(row) {
  if (!isHandleChangedFieldSet(row?.changedFields)) {
    return row;
  }

  const derived = buildHandleRedirectMetadata({
    baselineRow: row?.currentRow ?? row?.preWriteRow ?? null,
    editedRow: row?.editedRow ?? null,
  });

  return {
    ...row,
    nextHandle: row?.nextHandle ?? derived.nextHandle,
    previousHandle: row?.previousHandle ?? derived.previousHandle,
    redirectPath: row?.redirectPath ?? derived.redirectPath,
    redirectTarget: row?.redirectTarget ?? derived.redirectTarget,
  };
}

function stripAlreadyAppliedHandleChange(row) {
  const changedFields = removeAlreadyAppliedHandleField(row?.changedFields, {
    editedRow: row?.editedRow ?? null,
    liveRow: row?.currentRow ?? row?.preWriteRow ?? null,
  });

  if (changedFields.length === (row?.changedFields ?? []).length) {
    return row;
  }

  return {
    ...row,
    changedFields,
    nextHandle: null,
    previousHandle: null,
    redirectPath: null,
    redirectTarget: null,
  };
}

async function persistNoopWriteResult({
  artifactCatalog,
  artifactKeyPrefix,
  artifactStorage,
  job,
  payload,
}) {
  const summary = {
    rollbackableRowCount: 0,
    total: 0,
    verifiedSuccess: 0,
  };
  const resultPayload = {
    outcome: "verified_success",
    previewDigest: payload.previewDigest,
    previewJobId: payload.previewJobId,
    profile: payload.profile,
    rows: [],
    summary,
  };

  await persistJsonArtifact({
    artifactCatalog,
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
      rollbackableRowCount: 0,
      total: 0,
    },
  });

  return resultPayload;
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
    { readRedirectsByPaths: defaultReadRedirectsByPaths },
    { updateProductCoreFields },
    offlineAdminModule,
  ] = await Promise.all([
    import("../domain/artifacts/prisma-artifact-catalog.mjs"),
    import("../platform/shopify/product-preview.server.mjs"),
    import("../platform/shopify/product-redirects.server.mjs"),
    import("../platform/shopify/product-write.server.mjs"),
    import("./offline-admin.mjs"),
  ]);

  return {
    createPrismaArtifactCatalog,
    loadOfflineAdminContext: offlineAdminModule.loadOfflineAdminContext,
    MissingOfflineSessionError: offlineAdminModule.MissingOfflineSessionError,
    readProductsForPreview,
    readRedirectsByPaths: defaultReadRedirectsByPaths,
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
  readLiveMetafields,
  readLiveProducts,
  readLiveRedirects,
  resolveAdminContext,
  setMetafields,
  updateProduct,
} = {}) {
  if (job?.payload?.profile === PRODUCT_MEDIA_EXPORT_PROFILE) {
    return runMediaProductWriteJob({
      artifactCatalog,
      artifactKeyPrefix,
      artifactStorage,
      assertJobLeaseActive,
      job,
      prisma,
      resolveAdminContext,
    });
  }

  if (job?.payload?.profile === PRODUCT_METAFIELDS_EXPORT_PROFILE) {
    return runMetafieldProductWriteJob({
      artifactCatalog,
      artifactKeyPrefix,
      artifactStorage,
      assertJobLeaseActive,
      job,
      prisma,
      readLiveMetafields,
      resolveAdminContext,
      setMetafields,
    });
  }

  if (job?.payload?.profile === PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE) {
    return runCollectionProductWriteJob({
      artifactCatalog,
      artifactKeyPrefix,
      artifactStorage,
      assertJobLeaseActive,
      job,
      prisma,
      resolveAdminContext,
    });
  }

  if (job?.payload?.profile === PRODUCT_INVENTORY_EXPORT_PROFILE) {
    return runInventoryProductWriteJob({
      artifactCatalog,
      artifactKeyPrefix,
      artifactStorage,
      assertJobLeaseActive,
      job,
      prisma,
      readLiveInventory: readLiveProducts,
      resolveAdminContext,
      setInventoryQuantities: updateProduct,
    });
  }

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

  const defaultDependencies = artifactCatalog
    && readLiveProducts
    && readLiveRedirects
    && resolveAdminContext
    && updateProduct
    ? null
    : await loadDefaultDependencies();
  const catalog = artifactCatalog ?? defaultDependencies.createPrismaArtifactCatalog(prisma);
  const readProducts = readLiveProducts ?? defaultDependencies.readProductsForPreview;
  const readRedirects = readLiveRedirects ?? defaultDependencies.readRedirectsByPaths ?? readRedirectsByPaths;
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
    const writableRows = getWritablePreviewRows(previewPayload.rows)
      .map(hydrateHandleRedirectMetadata)
      .map(stripAlreadyAppliedHandleChange)
      .filter((row) => Array.isArray(row.changedFields) && row.changedFields.length > 0);
    if (writableRows.length === 0) {
      return persistNoopWriteResult({
        artifactCatalog: catalog,
        artifactKeyPrefix,
        artifactStorage,
        job,
        payload,
      });
    }
    const productIds = writableRows.map((row) => row.productId);

    const { admin } = await resolveAdmin({
      prisma,
      shopDomain: job.shopDomain,
    });

    assertJobLeaseActive();
    const revalidatedRowsByProductId = await readProducts(admin, productIds, {
      assertJobLeaseActive,
    });
    assertJobLeaseActive();
    const revalidatedRedirectsByPath = await readRedirects(
      admin,
      collectHandleChangeRedirectPaths(writableRows),
      { assertJobLeaseActive },
    );

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
      const redirectConflict = isHandleChangedFieldSet(row.changedFields)
        && (revalidatedRedirectsByPath.get(row.redirectPath)?.length ?? 0) > 0;
      const messages = [];

      if (!matchesPreview) {
        messages.push("Live Shopify product changed after preview confirmation was requested");
      }
      if (redirectConflict) {
        messages.push("A live redirect already exists for the previous product handle");
      }

      return {
        changedFields: row.changedFields,
        editedRow: row.editedRow,
        finalRow: currentRow,
        messages,
        mutationStatus: "skipped",
        mutationUserErrors: [],
        nextHandle: row.nextHandle ?? null,
        preWriteRow: currentRow,
        previousHandle: row.previousHandle ?? null,
        productId: row.productId,
        redirectPath: row.redirectPath ?? null,
        redirectTarget: row.redirectTarget ?? null,
        verificationStatus: matchesPreview && !redirectConflict ? "pending" : "revalidation_failed",
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
        nextHandle: row.nextHandle ?? null,
        preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
        previousHandle: row.previousHandle ?? null,
        previewCurrentRow: row.currentRow,
        productId: row.productId,
        redirectPath: row.redirectPath ?? null,
        redirectTarget: row.redirectTarget ?? null,
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
          nextHandle: row.nextHandle ?? null,
          preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
          previousHandle: row.previousHandle ?? null,
          productId: row.productId,
          redirectPath: row.redirectPath ?? null,
          redirectTarget: row.redirectTarget ?? null,
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
          nextHandle: row.nextHandle ?? null,
          preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
          previousHandle: row.previousHandle ?? null,
          productId: row.productId,
          redirectPath: row.redirectPath ?? null,
          redirectTarget: row.redirectTarget ?? null,
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
          nextHandle: row.nextHandle ?? null,
          preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
          previousHandle: row.previousHandle ?? null,
          productId: row.productId,
          redirectPath: row.redirectPath ?? null,
          redirectTarget: row.redirectTarget ?? null,
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
          nextHandle: row.nextHandle ?? null,
          preWriteRow: revalidatedRowsByProductId.get(row.productId) ?? null,
          previousHandle: row.previousHandle ?? null,
          productId: row.productId,
          redirectPath: row.redirectPath ?? null,
          redirectTarget: row.redirectTarget ?? null,
          verificationStatus: "skipped",
        });
      }
    }

    assertJobLeaseActive();
    const finalRowsByProductId = await readProducts(admin, productIds, {
      assertJobLeaseActive,
    });
    assertJobLeaseActive();
    const finalRedirectsByPath = await readRedirects(
      admin,
      collectHandleChangeRedirectPaths(mutationRows),
      { assertJobLeaseActive },
    );
    const finalRedirectLookup = buildRedirectLookup(finalRedirectsByPath);

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
      const isHandleRow = isHandleChangedFieldSet(row.changedFields);
      const preWriteHandle = normalizeProductHandle(row.preWriteRow?.handle);
      const editedHandle = normalizeProductHandle(row.editedRow?.handle);
      const handleApplied = isHandleRow
        && row.mutationStatus !== "skipped"
        && preWriteHandle !== editedHandle
        && normalizeProductHandle(finalRow?.handle) === editedHandle;
      const exactRedirectMatches = isHandleRow
        ? (finalRedirectsByPath.get(row.redirectPath) ?? []).filter((redirect) => redirect.target === row.redirectTarget)
        : [];
      const exactRedirect = exactRedirectMatches.length === 1
        ? finalRedirectLookup.get(buildRedirectLookupKey({
          path: row.redirectPath,
          target: row.redirectTarget,
        }))
        : null;
      const redirectVerified = !isHandleRow || exactRedirectMatches.length === 1;
      const messages = [...row.messages];

      if (verified && !redirectVerified) {
        messages.push("Final-state redirect verification failed");
      } else if (!verified) {
        messages.push("Final-state verification failed");
      }

      return {
        ...row,
        finalRow,
        messages,
        redirectCleanupMode: handleApplied
          ? exactRedirect
            ? "delete-by-id"
            : "lookup-by-path-target-or-none"
          : null,
        redirectId: exactRedirect?.id ?? null,
        rollbackableHandleChange: handleApplied,
        verificationStatus: verified && redirectVerified ? "verified" : "failed",
      };
    });

    const rollbackableRowCount = verifiedRows.filter((row) => row.rollbackableHandleChange).length;
    const outcome = buildBusinessOutcome(verifiedRows, { rollbackableRowCount });
    const summary = {
      rollbackableRowCount,
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
        rollbackableRowCount,
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
