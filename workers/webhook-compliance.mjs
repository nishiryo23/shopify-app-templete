import { eraseShopData } from "../domain/webhooks/compliance.server.mjs";

export async function runWebhookShopRedactJob({
  artifactStorage,
  assertJobLeaseActive = () => {},
  job,
  now = new Date(),
  prisma,
} = {}) {
  const deliveryKey = job?.payload?.deliveryKey;

  if (!job?.shopDomain) {
    throw new Error("missing-shop-domain");
  }

  if (!deliveryKey) {
    throw new Error("missing-delivery-key");
  }

  assertJobLeaseActive();
  return eraseShopData({
    artifactStorage,
    assertJobLeaseActive,
    preserveDeliveryKey: deliveryKey,
    preserveJobId: job.id,
    prisma,
    processedAt: now,
    shopDomain: job.shopDomain,
  });
}
