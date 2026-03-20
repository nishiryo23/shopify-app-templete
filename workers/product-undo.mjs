import {
  buildProductWriteArtifactKey,
  PRODUCT_UNDO_ERROR_ARTIFACT_KIND,
  PRODUCT_UNDO_RESULT_ARTIFACT_KIND,
} from "../domain/products/write-profile.mjs";
import {
  buildRollbackInputFromSnapshotRow,
  changedFieldsMatch,
} from "../domain/products/write-rows.mjs";
import {
  isHandleChangedFieldSet,
} from "../domain/products/redirects.mjs";
import {
  deleteRedirectById,
  readRedirectsByPaths,
} from "../platform/shopify/product-redirects.server.mjs";

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

async function loadArtifactRecordOrThrow(prisma, { artifactId, includeDeleted = false, kind, shopDomain }) {
  const artifact = await prisma.artifact.findFirst({
    where: {
      deletedAt: includeDeleted ? undefined : null,
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

function isArtifactRetentionExpired({ artifact, now = new Date() }) {
  return artifact?.deletedAt != null
    || (artifact?.retentionUntil != null && artifact.retentionUntil <= now);
}

function buildRetentionExpiredError(kind) {
  const error = new Error(`retention-expired:${kind}`);
  error.code = "retention-expired";
  return error;
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
    redirectModule,
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
    deleteRedirectById: redirectModule.deleteRedirectById,
    readProductsForPreview,
    readRedirectsByPaths: redirectModule.readRedirectsByPaths,
    updateProductCoreFields,
  };
}

function buildSnapshotResultJoin({ snapshotRows, writeRows }) {
  const snapshotByProductId = new Map(snapshotRows.map((row) => [row.productId, row]));
  const resultByProductId = new Map(writeRows.map((row) => [row.productId, row]));

  for (const snapshotRow of snapshotRows) {
    if (!resultByProductId.has(snapshotRow.productId)) {
      throw new Error(`missing-write-result-row:${snapshotRow.productId}`);
    }
  }

  for (const writeRow of writeRows) {
    if (!snapshotByProductId.has(writeRow.productId)) {
      throw new Error(`missing-write-snapshot-row:${writeRow.productId}`);
    }
  }

  return snapshotRows.map((snapshotRow) => ({
    resultRow: resultByProductId.get(snapshotRow.productId),
    snapshotRow,
  }));
}

function isRollbackTarget(joinedRow) {
  const changedFields = joinedRow.snapshotRow?.changedFields ?? [];
  if (isHandleChangedFieldSet(changedFields)) {
    return joinedRow.resultRow?.rollbackableHandleChange === true;
  }

  const mutationStatus = joinedRow.resultRow?.mutationStatus ?? null;
  return mutationStatus === "success" || mutationStatus === "applied";
}

async function cleanupForwardRedirectForUndo({
  admin,
  assertJobLeaseActive,
  deleteRedirectHelper,
  readRedirects,
  resultRow,
}) {
  if (resultRow?.redirectCleanupMode === "delete-by-id") {
    const cleanup = await deleteRedirectHelper(admin, resultRow.redirectId);
    if (cleanup.notFound) {
      return {
        messages: ["Forward redirect was already removed before undo"],
        ok: true,
      };
    }

    if (cleanup.userErrors?.length) {
      return {
        messages: cleanup.userErrors.map((entry) => entry.message),
        ok: false,
      };
    }

    return { messages: [], ok: true };
  }

  if (resultRow?.redirectCleanupMode === "lookup-by-path-target-or-none") {
    const redirectsByPath = await readRedirects(admin, [resultRow.redirectPath], { assertJobLeaseActive });
    const redirectsForPath = redirectsByPath.get(resultRow.redirectPath) ?? [];
    const exactMatches = redirectsForPath.filter((redirect) => redirect.target === resultRow.redirectTarget);

    if (redirectsForPath.length > 0 && exactMatches.length !== 1) {
      return {
        messages: ["Redirect cleanup could not determine a single exact redirect to remove"],
        ok: false,
      };
    }

    if (exactMatches.length === 1) {
      const cleanup = await deleteRedirectHelper(admin, exactMatches[0].id);
      if (cleanup.notFound) {
        return {
          messages: ["Forward redirect was already removed before undo"],
          ok: true,
        };
      }

      if (cleanup.userErrors?.length) {
        return {
          messages: cleanup.userErrors.map((entry) => entry.message),
          ok: false,
        };
      }
    }
  }

  return { messages: [], ok: true };
}

export async function runProductUndoJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  deleteRedirect,
  job,
  now = new Date(),
  prisma,
  readLiveProducts,
  readLiveRedirects,
  resolveAdminContext,
  updateProduct,
} = {}) {
  const defaultDependencies = artifactCatalog
    && readLiveProducts
    && readLiveRedirects
    && resolveAdminContext
    && updateProduct
    && deleteRedirect
    ? null
    : await loadDefaultDependencies();
  const catalog = artifactCatalog ?? defaultDependencies.createPrismaArtifactCatalog(prisma);
  const deleteRedirectHelper = deleteRedirect ?? defaultDependencies.deleteRedirectById ?? deleteRedirectById;
  const readProducts = readLiveProducts ?? defaultDependencies.readProductsForPreview;
  const readRedirects = readLiveRedirects ?? defaultDependencies.readRedirectsByPaths ?? readRedirectsByPaths;
  const resolveAdmin = resolveAdminContext ?? defaultDependencies.loadOfflineAdminContext;
  const updateProductCore = updateProduct ?? defaultDependencies.updateProductCoreFields;
  let errorArtifactDescriptor = null;
  let errorArtifactRecord = null;

  try {
    const payload = job.payload ?? {};
    const [writeArtifact, snapshotArtifact] = await Promise.all([
      loadArtifactRecordOrThrow(prisma, {
        artifactId: payload.writeArtifactId,
        includeDeleted: true,
        kind: "product.write.result",
        shopDomain: job.shopDomain,
      }),
      loadArtifactRecordOrThrow(prisma, {
        artifactId: payload.snapshotArtifactId,
        includeDeleted: true,
        kind: "product.write.snapshot",
        shopDomain: job.shopDomain,
      }),
    ]);

    if (isArtifactRetentionExpired({ artifact: writeArtifact, now })) {
      throw buildRetentionExpiredError("product.write.result");
    }

    if (isArtifactRetentionExpired({ artifact: snapshotArtifact, now })) {
      throw buildRetentionExpiredError("product.write.snapshot");
    }

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
    const joinedRows = buildSnapshotResultJoin({
      snapshotRows,
      writeRows: writePayload.rows ?? [],
    });
    const rollbackTargets = joinedRows.filter(isRollbackTarget);
    const productIds = rollbackTargets.map((entry) => entry.snapshotRow.productId);

    const { admin } = await resolveAdmin({
      prisma,
      shopDomain: job.shopDomain,
    });
    assertJobLeaseActive();
    const currentRowsByProductId = await readProducts(admin, productIds, {
      assertJobLeaseActive,
    });

    const conflictingRows = rollbackTargets.map(({ resultRow, snapshotRow }) => {
      const currentRow = currentRowsByProductId.get(snapshotRow.productId) ?? null;
      const matches = changedFieldsMatch({
        actualRow: currentRow,
        changedFields: snapshotRow.changedFields,
        expectedRow: resultRow?.finalRow,
      });

      return {
        changedFields: snapshotRow.changedFields,
        conflict: !matches,
        currentRow,
        finalRow: resultRow?.finalRow ?? null,
        messages: matches ? [] : ["Live Shopify product drifted after the successful write"],
        nextHandle: resultRow?.nextHandle ?? null,
        productId: snapshotRow.productId,
        redirectCleanupMode: resultRow?.redirectCleanupMode ?? null,
        redirectId: resultRow?.redirectId ?? null,
        redirectPath: resultRow?.redirectPath ?? null,
        redirectTarget: resultRow?.redirectTarget ?? null,
        rollbackStatus: "skipped",
        snapshotRow: snapshotRow.preWriteRow,
        writeResultRow: resultRow ?? null,
        verificationStatus: matches ? "pending" : "conflict",
      };
    });

    if (conflictingRows.some((row) => row.conflict)) {
      const resultPayload = {
        outcome: "conflict",
        rows: conflictingRows,
        snapshotArtifactId: payload.snapshotArtifactId,
        summary: {
          total: rollbackTargets.length,
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
          total: rollbackTargets.length,
          writeJobId: payload.writeJobId,
        },
      });
      return resultPayload;
    }

    const rollbackRows = [];
    for (const { resultRow, snapshotRow } of rollbackTargets) {
      assertJobLeaseActive();
      const currentRow = currentRowsByProductId.get(snapshotRow.productId) ?? null;
      const messages = [];
      const isHandleRow = isHandleChangedFieldSet(snapshotRow.changedFields);

      const mutation = buildRollbackInputFromSnapshotRow(snapshotRow);

      if (!mutation.ok) {
        rollbackRows.push({
          changedFields: snapshotRow.changedFields,
          conflict: false,
          currentRow,
          finalRow: null,
          messages: messages.concat(mutation.errors),
          nextHandle: resultRow?.nextHandle ?? null,
          productId: snapshotRow.productId,
          redirectCleanupMode: resultRow?.redirectCleanupMode ?? null,
          redirectId: resultRow?.redirectId ?? null,
          redirectPath: resultRow?.redirectPath ?? null,
          redirectTarget: resultRow?.redirectTarget ?? null,
          rollbackStatus: "failed",
          snapshotRow: snapshotRow.preWriteRow,
          writeResultRow: resultRow ?? null,
          verificationStatus: "failed",
        });
        continue;
      }

      if (isHandleRow) {
        const cleanup = await cleanupForwardRedirectForUndo({
          admin,
          assertJobLeaseActive,
          deleteRedirectHelper,
          readRedirects,
          resultRow,
        });
        messages.push(...cleanup.messages);

        if (!cleanup.ok) {
          rollbackRows.push({
            changedFields: snapshotRow.changedFields,
            conflict: false,
            currentRow,
            finalRow: null,
            messages,
            nextHandle: resultRow?.nextHandle ?? null,
            productId: snapshotRow.productId,
            redirectCleanupMode: resultRow?.redirectCleanupMode ?? null,
            redirectId: resultRow?.redirectId ?? null,
            redirectPath: resultRow?.redirectPath ?? null,
            redirectTarget: resultRow?.redirectTarget ?? null,
            rollbackStatus: "failed",
            snapshotRow: snapshotRow.preWriteRow,
            writeResultRow: resultRow ?? null,
            verificationStatus: "failed",
          });
          continue;
        }
      }

      const response = await updateProductCore(admin, mutation.input);
      const rollbackFailed = Array.isArray(response.userErrors) && response.userErrors.length > 0;
      rollbackRows.push({
        changedFields: snapshotRow.changedFields,
        conflict: false,
        currentRow,
        finalRow: null,
        messages: rollbackFailed ? messages.concat(response.userErrors.map((entry) => entry.message)) : messages,
        nextHandle: resultRow?.nextHandle ?? null,
        productId: snapshotRow.productId,
        redirectCleanupMode: resultRow?.redirectCleanupMode ?? null,
        redirectId: resultRow?.redirectId ?? null,
        redirectPath: resultRow?.redirectPath ?? null,
        redirectTarget: resultRow?.redirectTarget ?? null,
        rollbackStatus: rollbackFailed ? "failed" : "success",
        snapshotRow: snapshotRow.preWriteRow,
        writeResultRow: resultRow ?? null,
        verificationStatus: rollbackFailed ? "failed" : "pending",
      });
    }

    assertJobLeaseActive();
    const finalRowsByProductId = await readProducts(admin, productIds, {
      assertJobLeaseActive,
    });
    const finalRedirectsByPath = await readRedirects(
      admin,
      [...new Set(rollbackRows.map((row) => row.redirectPath).filter(Boolean))],
      { assertJobLeaseActive },
    );
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
      const redirectsForPath = row.redirectPath
        ? (finalRedirectsByPath.get(row.redirectPath) ?? [])
        : [];
      const redirectCleared = !row.redirectPath || redirectsForPath.length === 0;
      return {
        ...row,
        finalRow,
        messages: verified && redirectCleared
          ? row.messages
          : row.messages.concat(
            redirectCleared
              ? "Undo verification failed"
              : "A live redirect still exists for the previous product handle after undo",
          ),
        verificationStatus: verified && redirectCleared ? "verified" : "failed",
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
        total: rollbackTargets.length,
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
        total: rollbackTargets.length,
        writeJobId: payload.writeJobId,
      },
    });
    return resultPayload;
  } catch (error) {
    if (isMissingOfflineSessionError(error, defaultDependencies?.MissingOfflineSessionError)) {
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
