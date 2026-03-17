import {
  buildProductPreviewDedupeKey,
  buildProductPreviewPayload,
  PRODUCT_PREVIEW_KIND,
} from "./preview-profile.mjs";

export function buildActiveProductPreviewWhere({
  editedDigest,
  editedLayout = "canonical",
  editedRowMapDigest = "none",
  exportJobId,
  shopDomain,
}) {
  return {
    dedupeKey: buildProductPreviewDedupeKey({
      editedDigest,
      editedLayout,
      editedRowMapDigest,
      exportJobId,
    }),
    kind: PRODUCT_PREVIEW_KIND,
    shopDomain,
    state: {
      in: ["queued", "retryable", "leased"],
    },
  };
}

export async function findActiveProductPreviewJob({
  editedDigest,
  editedLayout = "canonical",
  editedRowMapDigest = "none",
  exportJobId,
  prisma,
  shopDomain,
}) {
  return prisma.job.findFirst({
    orderBy: [{ createdAt: "desc" }],
    where: buildActiveProductPreviewWhere({
      editedDigest,
      editedLayout,
      editedRowMapDigest,
      exportJobId,
      shopDomain,
    }),
  });
}

export async function enqueueProductPreviewJob({
  editedDigest,
  editedFormat,
  editedLayout = "canonical",
  editedRowMapDigest = "none",
  editedUploadArtifactId,
  exportJobId,
  jobQueue,
  manifestArtifactId,
  profile,
  shopDomain,
  sourceFormat,
  sourceArtifactId,
}) {
  return jobQueue.enqueue({
    dedupeKey: buildProductPreviewDedupeKey({
      editedDigest,
      editedLayout,
      editedRowMapDigest,
      exportJobId,
    }),
    kind: PRODUCT_PREVIEW_KIND,
    maxAttempts: 1,
    payload: buildProductPreviewPayload({
      editedDigest,
      editedFormat,
      editedLayout,
      editedRowMapDigest,
      editedUploadArtifactId,
      exportJobId,
      manifestArtifactId,
      profile,
      sourceFormat,
      sourceArtifactId,
    }),
    shopDomain,
  });
}

export async function enqueueOrFindActiveProductPreviewJob({
  editedDigest,
  editedFormat,
  editedLayout = "canonical",
  editedRowMapDigest = "none",
  editedUploadArtifactId,
  exportJobId,
  jobQueue,
  manifestArtifactId,
  prisma,
  profile,
  shopDomain,
  sourceFormat,
  sourceArtifactId,
}) {
  let job = await enqueueProductPreviewJob({
    editedDigest,
    editedFormat,
    editedLayout,
    editedRowMapDigest,
    editedUploadArtifactId,
    exportJobId,
    jobQueue,
    manifestArtifactId,
    profile,
    shopDomain,
    sourceFormat,
    sourceArtifactId,
  });

  if (job) {
    return job;
  }

  job = await findActiveProductPreviewJob({
    editedDigest,
    editedLayout,
    editedRowMapDigest,
    exportJobId,
    prisma,
    shopDomain,
  });

  if (job) {
    return job;
  }

  job = await enqueueProductPreviewJob({
    editedDigest,
    editedFormat,
    editedLayout,
    editedRowMapDigest,
    editedUploadArtifactId,
    exportJobId,
    jobQueue,
    manifestArtifactId,
    profile,
    shopDomain,
    sourceFormat,
    sourceArtifactId,
  });

  if (job) {
    return job;
  }

  return findActiveProductPreviewJob({
    editedDigest,
    editedLayout,
    editedRowMapDigest,
    exportJobId,
    prisma,
    shopDomain,
  });
}
