import crypto from "node:crypto";

function getHeader(headers, name) {
  if (headers && typeof headers.get === "function") {
    return headers.get(name) ?? undefined;
  }

  const expectedName = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expectedName) {
      return value;
    }
  }

  return undefined;
}

function requireHeader(headers, name) {
  const value = getHeader(headers, name);
  return value ? value.trim() : undefined;
}

export function computeWebhookHmac({ rawBody, clientSecret }) {
  return crypto.createHmac("sha256", clientSecret).update(rawBody).digest("base64");
}

export function verifyWebhookHmac({ rawBody, clientSecret, hmacHeader }) {
  if (!hmacHeader) {
    return false;
  }

  const expected = computeWebhookHmac({ rawBody, clientSecret });
  const expectedBuffer = Buffer.from(expected);
  const headerBuffer = Buffer.from(hmacHeader);

  if (expectedBuffer.length !== headerBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, headerBuffer);
}

export function createWebhookInboxStore() {
  const seenDeliveryKeys = new Set();
  const writes = [];

  return {
    async enqueueIfAbsent(record) {
      if (seenDeliveryKeys.has(record.deliveryKey)) {
        return false;
      }

      seenDeliveryKeys.add(record.deliveryKey);
      writes.push(record);

      return true;
    },
    getWrites() {
      return [...writes];
    },
  };
}

export async function processWebhookIngress({ headers, rawBody, clientSecret, inbox }) {
  const hmacHeader = getHeader(headers, "X-Shopify-Hmac-SHA256");

  if (!verifyWebhookHmac({ rawBody, clientSecret, hmacHeader })) {
    return { status: 401, outcome: "invalid-hmac", enqueued: false };
  }

  const eventId = requireHeader(headers, "X-Shopify-Event-Id");
  if (!eventId) {
    return { status: 400, outcome: "missing-event-id", enqueued: false };
  }

  const shopDomain = requireHeader(headers, "X-Shopify-Shop-Domain");
  if (!shopDomain) {
    return { status: 400, outcome: "missing-shop-domain", enqueued: false };
  }

  const topic = requireHeader(headers, "X-Shopify-Topic");
  if (!topic) {
    return { status: 400, outcome: "missing-topic", enqueued: false };
  }

  const webhookId = requireHeader(headers, "X-Shopify-Webhook-Id");
  const subscriptionName = requireHeader(headers, "X-Shopify-Name");
  const deliveryKey = buildWebhookDeliveryKey({
    shopDomain,
    topic,
    eventId,
    webhookId,
    subscriptionName,
  });

  const enqueued = await inbox.enqueueIfAbsent({
    eventId,
    shopDomain,
    topic,
    webhookId,
    subscriptionName,
    deliveryKey,
    rawBody,
    hmacHeader,
  });

  if (!enqueued) {
    return { status: 200, outcome: "duplicate-no-op", enqueued: false };
  }

  return { status: 200, outcome: "accepted", enqueued: true };
}

function buildWebhookDeliveryKey({ shopDomain, topic, eventId, webhookId, subscriptionName }) {
  const subscriptionKey = subscriptionName || webhookId || "default";
  return JSON.stringify([shopDomain, topic, eventId, subscriptionKey]);
}

export { buildWebhookDeliveryKey };
