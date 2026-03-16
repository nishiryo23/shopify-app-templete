import {
  buildProductPreviewDedupeKey,
  buildProductPreviewPayload,
  PRODUCT_PREVIEW_KIND,
} from "./preview-profile.mjs";

export function buildActiveProductPreviewWhere({
  editedDigest,
  exportJobId,
  shopDomain,
}) {
  return {
    dedupeKey: buildProductPreviewDedupeKey({ editedDigest, exportJobId }),
    kind: PRODUCT_PREVIEW_KIND,
    shopDomain,
    state: {
      in: ["queued", "retryable", "leased"],
    },
  };
}

export async function findActiveProductPreviewJob({
  editedDigest,
  exportJobId,
  prisma,
  shopDomain,
}) {
  return prisma.job.findFirst({
    orderBy: [{ createdAt: "desc" }],
    where: buildActiveProductPreviewWhere({
      editedDigest,
      exportJobId,
      shopDomain,
    }),
  });
}

export async function enqueueProductPreviewJob({
  editedDigest,
  editedUploadArtifactId,
  exportJobId,
  format,
  jobQueue,
  manifestArtifactId,
  profile,
  shopDomain,
  sourceArtifactId,
}) {
  return jobQueue.enqueue({
    dedupeKey: buildProductPreviewDedupeKey({ editedDigest, exportJobId }),
    kind: PRODUCT_PREVIEW_KIND,
    maxAttempts: 1,
    payload: buildProductPreviewPayload({
      editedDigest,
      editedUploadArtifactId,
      exportJobId,
      format,
      manifestArtifactId,
      profile,
      sourceArtifactId,
    }),
    shopDomain,
  });
}

export async function enqueueOrFindActiveProductPreviewJob({
  editedDigest,
  editedUploadArtifactId,
  exportJobId,
  format,
  jobQueue,
  manifestArtifactId,
  prisma,
  profile,
  shopDomain,
  sourceArtifactId,
}) {
  let job = await enqueueProductPreviewJob({
    editedDigest,
    editedUploadArtifactId,
    exportJobId,
    format,
    jobQueue,
    manifestArtifactId,
    profile,
    shopDomain,
    sourceArtifactId,
  });

  if (job) {
    return job;
  }

  job = await findActiveProductPreviewJob({
    editedDigest,
    exportJobId,
    prisma,
    shopDomain,
  });

  if (job) {
    return job;
  }

  job = await enqueueProductPreviewJob({
    editedDigest,
    editedUploadArtifactId,
    exportJobId,
    format,
    jobQueue,
    manifestArtifactId,
    profile,
    shopDomain,
    sourceArtifactId,
  });

  if (job) {
    return job;
  }

  return findActiveProductPreviewJob({
    editedDigest,
    exportJobId,
    prisma,
    shopDomain,
  });
}
