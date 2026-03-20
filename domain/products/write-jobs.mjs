import {
  buildProductUndoDedupeKey,
  buildProductUndoPayload,
  buildProductWriteDedupeKey,
  buildProductWritePayload,
  PRODUCT_UNDO_KIND,
  PRODUCT_WRITE_KIND,
  PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
  PRODUCT_WRITE_SNAPSHOT_ARTIFACT_KIND,
} from "./write-profile.mjs";

const ACTIVE_STATES = Object.freeze(["queued", "retryable", "leased"]);
const SUCCESS_OUTCOME = "verified_success";
const ROLLBACKABLE_WRITE_OUTCOMES = new Set(["verified_success", "partial_failure"]);
const SUCCESSFUL_UNDO_KIND = "product.undo.result";

function isArtifactRetentionExpired({ artifact, now = new Date() }) {
  return artifact?.deletedAt != null
    || (artifact?.retentionUntil != null && artifact.retentionUntil <= now);
}

function isMatchingSuccessArtifact({ artifact, profile }) {
  const metadata = artifact.metadata ?? {};
  return metadata.outcome === SUCCESS_OUTCOME && metadata.profile === profile;
}

function isRollbackableWriteArtifact({ artifact, profile }) {
  const metadata = artifact.metadata ?? {};
  return ROLLBACKABLE_WRITE_OUTCOMES.has(metadata.outcome)
    && metadata.profile === profile
    && Boolean(metadata.snapshotArtifactId);
}

async function findVerifiedSuccessArtifacts({
  includeDeleted = false,
  kind,
  prisma,
  profile,
  shopDomain,
}) {
  let skip = 0;
  const take = 100;
  const matches = [];

  while (true) {
    const artifacts = await prisma.artifact.findMany({
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
      where: {
        deletedAt: includeDeleted ? undefined : null,
        kind,
        shopDomain,
      },
    });

    if (artifacts.length === 0) {
      return matches;
    }

    matches.push(...artifacts.filter((artifact) => isMatchingSuccessArtifact({ artifact, profile })));
    skip += artifacts.length;
  }
}

async function findRollbackableWriteArtifacts({
  includeDeleted = false,
  prisma,
  profile,
  shopDomain,
}) {
  let skip = 0;
  const take = 100;
  const matches = [];

  while (true) {
    const artifacts = await prisma.artifact.findMany({
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
      where: {
        deletedAt: includeDeleted ? undefined : null,
        kind: PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
        shopDomain,
      },
    });

    if (artifacts.length === 0) {
      return matches;
    }

    matches.push(...artifacts.filter((artifact) => isRollbackableWriteArtifact({ artifact, profile })));
    skip += artifacts.length;
  }
}

export function buildActiveProductWriteWhere({ previewJobId, shopDomain }) {
  return {
    dedupeKey: buildProductWriteDedupeKey({ previewJobId }),
    kind: PRODUCT_WRITE_KIND,
    shopDomain,
    state: {
      in: ACTIVE_STATES,
    },
  };
}

export function buildActiveProductUndoWhere({ shopDomain, writeJobId }) {
  return {
    dedupeKey: buildProductUndoDedupeKey({ writeJobId }),
    kind: PRODUCT_UNDO_KIND,
    shopDomain,
    state: {
      in: ACTIVE_STATES,
    },
  };
}

export async function findActiveProductWriteJob({ previewJobId, prisma, shopDomain }) {
  return prisma.job.findFirst({
    orderBy: [{ createdAt: "desc" }],
    where: buildActiveProductWriteWhere({ previewJobId, shopDomain }),
  });
}

export async function findActiveProductUndoJob({ prisma, shopDomain, writeJobId }) {
  return prisma.job.findFirst({
    orderBy: [{ createdAt: "desc" }],
    where: buildActiveProductUndoWhere({ shopDomain, writeJobId }),
  });
}

export async function enqueueProductWriteJob({
  confirmedBy,
  jobQueue,
  previewArtifactId,
  previewDigest,
  previewJobId,
  profile,
  shopDomain,
}) {
  return jobQueue.enqueue({
    dedupeKey: buildProductWriteDedupeKey({ previewJobId }),
    kind: PRODUCT_WRITE_KIND,
    maxAttempts: 1,
    payload: buildProductWritePayload({
      confirmedBy,
      previewArtifactId,
      previewDigest,
      previewJobId,
      profile,
    }),
    shopDomain,
  });
}

export async function enqueueProductUndoJob({
  jobQueue,
  profile,
  requestedBy,
  shopDomain,
  snapshotArtifactId,
  writeArtifactId,
  writeJobId,
}) {
  return jobQueue.enqueue({
    dedupeKey: buildProductUndoDedupeKey({ writeJobId }),
    kind: PRODUCT_UNDO_KIND,
    maxAttempts: 1,
    payload: buildProductUndoPayload({
      profile,
      requestedBy,
      snapshotArtifactId,
      writeArtifactId,
      writeJobId,
    }),
    shopDomain,
  });
}

export async function enqueueOrFindActiveProductWriteJob(args) {
  let job = await enqueueProductWriteJob(args);

  if (job) {
    return job;
  }

  job = await findActiveProductWriteJob({
    previewJobId: args.previewJobId,
    prisma: args.prisma,
    shopDomain: args.shopDomain,
  });

  if (job) {
    return job;
  }

  job = await enqueueProductWriteJob(args);
  if (job) {
    return job;
  }

  return findActiveProductWriteJob({
    previewJobId: args.previewJobId,
    prisma: args.prisma,
    shopDomain: args.shopDomain,
  });
}

export async function enqueueOrFindActiveProductUndoJob(args) {
  let job = await enqueueProductUndoJob(args);

  if (job) {
    return job;
  }

  job = await findActiveProductUndoJob({
    prisma: args.prisma,
    shopDomain: args.shopDomain,
    writeJobId: args.writeJobId,
  });

  if (job) {
    return job;
  }

  job = await enqueueProductUndoJob(args);
  if (job) {
    return job;
  }

  return findActiveProductUndoJob({
    prisma: args.prisma,
    shopDomain: args.shopDomain,
    writeJobId: args.writeJobId,
  });
}

async function findUndoneWriteJobIds({ includeDeleted = false, prisma, profile, shopDomain }) {
  const successfulUndoArtifacts = await findVerifiedSuccessArtifacts({
    includeDeleted,
    kind: SUCCESSFUL_UNDO_KIND,
    prisma,
    profile,
    shopDomain,
  });

  return new Set(
    successfulUndoArtifacts.map((artifact) => artifact.metadata?.writeJobId).filter(Boolean),
  );
}

export async function findVerifiedSuccessfulProductWriteArtifactByPreviewJobId({
  previewJobId,
  prisma,
  profile,
  shopDomain,
}) {
  const [artifacts, undoneWriteJobIds] = await Promise.all([
    findVerifiedSuccessArtifacts({
      kind: PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
      prisma,
      profile,
      shopDomain,
    }),
    findUndoneWriteJobIds({
      prisma,
      profile,
      shopDomain,
    }),
  ]);

  return artifacts.find((artifact) =>
    artifact.metadata?.previewJobId === previewJobId
    && !undoneWriteJobIds.has(artifact.jobId)
  ) ?? null;
}

export async function findLatestSuccessfulProductWriteArtifact({
  prisma,
  profile,
  shopDomain,
}) {
  const [undoneWriteJobIds, successfulWriteArtifacts] = await Promise.all([
    findUndoneWriteJobIds({
      prisma,
      profile,
      shopDomain,
    }),
    findRollbackableWriteArtifacts({
      prisma,
      profile,
      shopDomain,
    }),
  ]);

  return successfulWriteArtifacts.find((artifact) => !undoneWriteJobIds.has(artifact.jobId)) ?? null;
}

export async function findLatestRollbackableWriteState({
  now = new Date(),
  prisma,
  profile,
  shopDomain,
}) {
  const [undoneWriteJobIds, rollbackableWriteArtifacts] = await Promise.all([
    findUndoneWriteJobIds({
      includeDeleted: true,
      prisma,
      profile,
      shopDomain,
    }),
    findRollbackableWriteArtifacts({
      includeDeleted: true,
      prisma,
      profile,
      shopDomain,
    }),
  ]);
  const latestArtifact = rollbackableWriteArtifacts.find((artifact) => !undoneWriteJobIds.has(artifact.jobId));

  if (!latestArtifact?.jobId) {
    return null;
  }

  const snapshotArtifact = await prisma.artifact.findFirst({
    where: {
      jobId: latestArtifact.jobId,
      kind: PRODUCT_WRITE_SNAPSHOT_ARTIFACT_KIND,
      shopDomain,
    },
  });

  const retentionExpired = [latestArtifact, snapshotArtifact]
    .filter(Boolean)
    .some((artifact) => isArtifactRetentionExpired({ artifact, now }));

  return {
    artifact: latestArtifact,
    retentionExpired,
    snapshotArtifact,
  };
}

export function isVerifiedSuccessOutcome(artifact) {
  return artifact?.metadata?.outcome === SUCCESS_OUTCOME;
}
