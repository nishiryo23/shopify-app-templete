export const WEBHOOK_SHOP_REDACT_KIND = "webhook.shop-redact";

const ACTIVE_STATES = Object.freeze(["queued", "retryable", "leased"]);

export function buildWebhookShopRedactDedupeKey({ deliveryKey }) {
  return `webhook-shop-redact:${deliveryKey}`;
}

export function buildWebhookShopRedactPayload({
  deliveryKey,
  requestedAt = new Date(),
}) {
  return {
    deliveryKey,
    requestedAt: requestedAt.toISOString(),
  };
}

export function buildActiveWebhookShopRedactWhere({ deliveryKey, shopDomain }) {
  return {
    dedupeKey: buildWebhookShopRedactDedupeKey({ deliveryKey }),
    kind: WEBHOOK_SHOP_REDACT_KIND,
    shopDomain,
    state: {
      in: ACTIVE_STATES,
    },
  };
}

export async function findActiveWebhookShopRedactJob({
  deliveryKey,
  prisma,
  shopDomain,
}) {
  return prisma.job.findFirst({
    orderBy: [{ createdAt: "desc" }],
    where: buildActiveWebhookShopRedactWhere({ deliveryKey, shopDomain }),
  });
}

export async function enqueueWebhookShopRedactJob({
  deliveryKey,
  jobQueue,
  shopDomain,
}) {
  return jobQueue.enqueue({
    dedupeKey: buildWebhookShopRedactDedupeKey({ deliveryKey }),
    kind: WEBHOOK_SHOP_REDACT_KIND,
    maxAttempts: 5,
    payload: buildWebhookShopRedactPayload({
      deliveryKey,
    }),
    shopDomain,
  });
}

export async function enqueueOrFindActiveWebhookShopRedactJob(args) {
  let job = await enqueueWebhookShopRedactJob(args);

  if (job) {
    return job;
  }

  job = await findActiveWebhookShopRedactJob({
    deliveryKey: args.deliveryKey,
    prisma: args.prisma,
    shopDomain: args.shopDomain,
  });

  if (job) {
    return job;
  }

  job = await enqueueWebhookShopRedactJob(args);
  if (job) {
    return job;
  }

  return findActiveWebhookShopRedactJob({
    deliveryKey: args.deliveryKey,
    prisma: args.prisma,
    shopDomain: args.shopDomain,
  });
}
