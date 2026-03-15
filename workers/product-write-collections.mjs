import { createPrismaArtifactCatalog } from "../domain/artifacts/prisma-artifact-catalog.mjs";
import {
  buildCollectionMembershipSummary,
  buildCollectionWriteGroups,
  chunkCollectionWriteGroups,
  getWritableCollectionPreviewRows,
} from "../domain/collections/write-rows.mjs";
import {
  addProductsToCollection,
  readCollectionJob,
  readCollectionsForProducts,
  removeProductsFromCollection,
  resolveCollectionsByHandle,
  resolveCollectionsById,
} from "../platform/shopify/product-collections.server.mjs";
import {
  buildProductWriteArtifactKey,
  PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
  PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
} from "../domain/products/write-profile.mjs";
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

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForCollectionJobCompletion(
  admin,
  {
    assertJobLeaseActive = () => {},
    jobId,
    maxAttempts = 150,
    pollIntervalMs = 2000,
    readJob = readCollectionJob,
    sleep = delay,
  } = {},
) {
  if (!jobId) {
    return null;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    assertJobLeaseActive();
    const job = await readJob(admin, { jobId });
    if (!job || job.done) {
      return job;
    }

    if (attempt < maxAttempts - 1) {
      await sleep(pollIntervalMs);
    }
  }

  const error = new Error(`shopify-async-job-timeout:${jobId}`);
  error.code = "shopify-async-job-timeout";
  throw error;
}

function buildRowKey(row) {
  const collectionId = row?.resolvedCollectionId ?? row?.editedRow?.collection_id ?? "";
  return `${row?.productId ?? ""}\u001e${collectionId}`;
}

function normalizeHandle(value) {
  return String(value ?? "").trim().toLowerCase();
}

function collectionRowsMatch(leftRow, rightRow) {
  const headers = [
    "collection_handle",
    "collection_id",
    "collection_title",
    "membership",
    "product_handle",
    "product_id",
    "updated_at",
  ];

  return headers.every((header) => {
    if (header === "collection_handle") {
      return normalizeHandle(leftRow?.[header]) === normalizeHandle(rightRow?.[header]);
    }

    return (leftRow?.[header] ?? "") === (rightRow?.[header] ?? "");
  });
}

function resolvedCollectionMatchesPreview({ resolvedByHandle, resolvedById, row }) {
  const previewCollectionId = String(row?.editedRow?.collection_id ?? "").trim();
  const previewHandle = normalizeHandle(row?.editedRow?.collection_handle);
  const previewTitle = String(row?.editedRow?.collection_title ?? "");
  const expectedId = row?.resolvedCollectionId ?? previewCollectionId;

  const idMatchesPreview = !previewCollectionId
    || (resolvedById != null && resolvedById.id === previewCollectionId && resolvedById.id === expectedId);
  const handleMatchesPreview = !previewHandle
    || (resolvedByHandle != null
      && normalizeHandle(resolvedByHandle.handle) === previewHandle
      && resolvedByHandle.id === expectedId);
  const resolvedCollection = resolvedById ?? resolvedByHandle ?? null;
  const titleMatchesPreview = !previewTitle
    || (resolvedCollection != null && String(resolvedCollection.title ?? "") === previewTitle);

  return idMatchesPreview && handleMatchesPreview && titleMatchesPreview;
}

function buildRevalidationFailedResult({ payload, rows }) {
  return {
    outcome: "revalidation_failed",
    previewDigest: payload.previewDigest,
    previewJobId: payload.previewJobId,
    profile: payload.profile,
    rows,
    summary: {
      total: rows.length,
    },
  };
}

function buildSkippedCollectionRow(row) {
  return {
    ...row,
    finalRow: null,
    messages: ["Write stopped after an earlier infrastructure failure"],
    mutationStatus: "skipped",
    mutationUserErrors: [],
    preWriteRow: row.currentRow,
    verificationStatus: "skipped",
  };
}

export async function runCollectionProductWriteJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  collectionJobPollIntervalMs = 2000,
  collectionJobPollMaxAttempts = 150,
  job,
  prisma,
  readLiveCollections = readCollectionsForProducts,
  readJob = readCollectionJob,
  resolveAdminContext = loadOfflineAdminContext,
  resolveHandles = resolveCollectionsByHandle,
  resolveIds = resolveCollectionsById,
  sleep = delay,
  addMemberships = addProductsToCollection,
  removeMemberships = removeProductsFromCollection,
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
    const writableRows = getWritableCollectionPreviewRows(previewPayload.rows);

    if (writableRows.length === 0) {
      const resultPayload = buildRevalidationFailedResult({ payload, rows: [] });
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
    const collectionIds = [...new Set(writableRows.map((row) => row.resolvedCollectionId).filter(Boolean))];
    const collectionHandles = [...new Set(
      writableRows
        .map((row) => String(row?.editedRow?.collection_handle ?? "").trim().toLowerCase())
        .filter(Boolean),
    )];

    const { admin } = await resolveAdminContext({
      prisma,
      shopDomain: job.shopDomain,
    });

    const [revalidatedState, resolvedCollectionsByHandle, resolvedCollectionsById] = await Promise.all([
      readLiveCollections(admin, productIds, { assertJobLeaseActive }),
      resolveHandles(admin, collectionHandles, { assertJobLeaseActive }),
      resolveIds(admin, collectionIds, { assertJobLeaseActive }),
    ]);

    const revalidationRows = writableRows.map((row) => {
      const currentRow = revalidatedState.currentRowsByKey.get(buildRowKey(row)) ?? null;
      const handle = String(row?.editedRow?.collection_handle ?? "").trim().toLowerCase();
      const resolvedByHandle = handle ? resolvedCollectionsByHandle.get(handle) ?? null : null;
      const resolvedById = row.resolvedCollectionId
        ? resolvedCollectionsById.get(row.resolvedCollectionId) ?? null
        : null;
      const currentMatchesPreview = (row.currentRow == null && currentRow == null)
        || (
          row.currentRow != null
          && currentRow != null
          && collectionRowsMatch(currentRow, row.currentRow)
        );
      const collectionMatchesPreview = resolvedCollectionMatchesPreview({
        resolvedByHandle,
        resolvedById,
        row,
      });

      return {
        ...row,
        currentRow,
        finalRow: currentRow,
        messages: currentMatchesPreview && collectionMatchesPreview
          ? []
          : ["Live Shopify collection changed after preview confirmation was requested"],
        mutationStatus: "skipped",
        mutationUserErrors: [],
        preWriteRow: currentRow,
        verificationStatus: currentMatchesPreview && collectionMatchesPreview ? "pending" : "revalidation_failed",
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

    const groups = chunkCollectionWriteGroups(buildCollectionWriteGroups(revalidationRows));
    const mutationRows = [];
    let infrastructureError = null;

    for (const group of groups) {
      assertJobLeaseActive();
      try {
        const response = group.operation === "add"
          ? await addMemberships(admin, {
            collectionId: group.collectionId,
            productIds: group.productIds,
          })
          : await removeMemberships(admin, {
            collectionId: group.collectionId,
            productIds: group.productIds,
          });

        const rowErrors = Array.isArray(response.userErrors) ? response.userErrors : [];
        const mutationFailed = rowErrors.length > 0;

        if (!mutationFailed) {
          await waitForCollectionJobCompletion(admin, {
            assertJobLeaseActive,
            jobId: response.job?.id ?? null,
            maxAttempts: collectionJobPollMaxAttempts,
            pollIntervalMs: collectionJobPollIntervalMs,
            readJob,
            sleep,
          });
        }

        for (const row of group.rows) {
          mutationRows.push({
            ...row,
            finalRow: null,
            messages: rowErrors.map((error) => error.message),
            mutationStatus: mutationFailed ? "failed" : "applied",
            mutationUserErrors: rowErrors,
            preWriteRow: row.currentRow,
            verificationStatus: mutationFailed ? "failed" : "pending",
          });
        }
      } catch (error) {
        infrastructureError = error;
        for (const row of group.rows) {
          mutationRows.push({
            ...row,
            finalRow: null,
            messages: [error instanceof Error ? error.message : "collection membership write failed"],
            mutationStatus: "failed",
            mutationUserErrors: [],
            preWriteRow: row.currentRow,
            verificationStatus: "pending",
          });
        }
        break;
      }
    }

    if (infrastructureError) {
      const processedRowNumbers = new Set(mutationRows.map((row) => row.editedRowNumber));
      for (const row of revalidationRows) {
        if (processedRowNumbers.has(row.editedRowNumber)) {
          continue;
        }

        mutationRows.push(buildSkippedCollectionRow(row));
      }
    }

    const finalState = await readLiveCollections(admin, productIds, { assertJobLeaseActive });
    const finalRows = mutationRows.map((row) => {
      const finalRow = finalState.currentRowsByKey.get(buildRowKey(row)) ?? null;
      if (row.verificationStatus !== "pending") {
        return row;
      }

      const verified = row.operation === "add" ? Boolean(finalRow) : finalRow == null;

      return {
        ...row,
        finalRow,
        messages: verified ? row.messages : [...row.messages, "Final Shopify collection membership does not match the confirmed preview row"],
        verificationStatus: verified ? "verified" : "verification_failed",
      };
    });

    const summary = buildCollectionMembershipSummary(finalRows);
    const resultPayload = {
      outcome: buildBusinessOutcome(finalRows),
      previewDigest: payload.previewDigest,
      previewJobId: payload.previewJobId,
      profile: payload.profile,
      rows: finalRows,
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
        outcome: resultPayload.outcome,
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
          code: infrastructureError?.code ?? "collection-membership-write-failed",
          message: infrastructureError?.message ?? "collection membership write failed",
        },
        fileName: "error.json",
        job,
        kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
        metadata: {
          code: infrastructureError?.code ?? "collection-membership-write-failed",
          profile: payload.profile ?? null,
        },
      });
      errorArtifactDescriptor = errorArtifact.descriptor;
      errorArtifactRecord = errorArtifact.record;
      skipErrorArtifactPersistence = true;
      throw infrastructureError;
    }

    return resultPayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "product manual collection write job failed";
    if (error instanceof MissingOfflineSessionError) {
      error.code = "missing-offline-session";
    }

    if (!skipErrorArtifactPersistence) {
      try {
        const persisted = await persistJsonArtifact({
          artifactCatalog: catalog,
          artifactKeyPrefix,
          artifactStorage,
          body: { error: message },
          fileName: "error.json",
          job,
          kind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
          metadata: {
            error: message,
            profile: job?.payload?.profile ?? null,
          },
        });
        errorArtifactDescriptor = persisted.descriptor;
        errorArtifactRecord = persisted.record;
      } catch {
        // Keep the original error path intact.
      }
    }

    throw error;
  } finally {
    if (skipErrorArtifactPersistence) {
      await Promise.allSettled([
        markDeletedIfPresent(catalog, errorArtifactRecord),
        deleteIfPresent(artifactStorage, errorArtifactDescriptor),
      ]);
    }
  }
}
