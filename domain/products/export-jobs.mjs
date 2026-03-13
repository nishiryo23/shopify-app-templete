import {
  buildProductExportDedupeKey,
  buildProductExportPayload,
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_EXPORT_FORMAT,
  PRODUCT_EXPORT_KIND,
} from "./export-profile.mjs";

export function buildActiveProductExportWhere({
  format = PRODUCT_EXPORT_FORMAT,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
  shopDomain,
}) {
  return {
    dedupeKey: buildProductExportDedupeKey({ format, profile }),
    kind: PRODUCT_EXPORT_KIND,
    shopDomain,
    state: {
      in: ["queued", "retryable", "leased"],
    },
  };
}

export async function findActiveProductExportJob({
  prisma,
  format = PRODUCT_EXPORT_FORMAT,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
  shopDomain,
}) {
  return prisma.job.findFirst({
    orderBy: [{ createdAt: "desc" }],
    where: buildActiveProductExportWhere({ format, profile, shopDomain }),
  });
}

export async function findLatestProductExportJob({
  prisma,
  format = PRODUCT_EXPORT_FORMAT,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
  shopDomain,
}) {
  return prisma.job.findFirst({
    orderBy: [{ createdAt: "desc" }],
    where: {
      dedupeKey: buildProductExportDedupeKey({ format, profile }),
      kind: PRODUCT_EXPORT_KIND,
      shopDomain,
    },
  });
}

export async function enqueueProductExportJob({
  format = PRODUCT_EXPORT_FORMAT,
  jobQueue,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
  shopDomain,
}) {
  return jobQueue.enqueue({
    dedupeKey: buildProductExportDedupeKey({ format, profile }),
    kind: PRODUCT_EXPORT_KIND,
    maxAttempts: 1,
    payload: buildProductExportPayload({ format, profile }),
    shopDomain,
  });
}

export async function enqueueOrFindActiveProductExportJob({
  format = PRODUCT_EXPORT_FORMAT,
  jobQueue,
  prisma,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
  shopDomain,
}) {
  let job = await enqueueProductExportJob({
    format,
    jobQueue,
    profile,
    shopDomain,
  });

  if (job) {
    return job;
  }

  job = await findActiveProductExportJob({
    format,
    prisma,
    profile,
    shopDomain,
  });

  if (job) {
    return job;
  }

  job = await enqueueProductExportJob({
    format,
    jobQueue,
    profile,
    shopDomain,
  });

  if (job) {
    return job;
  }

  return findActiveProductExportJob({
    format,
    prisma,
    profile,
    shopDomain,
  });
}
