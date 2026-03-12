import test from "node:test";
import assert from "node:assert/strict";

import { createPrismaWebhookInboxStore } from "../../domain/webhooks/prisma-inbox-store.mjs";

function buildRecord() {
  return {
    deliveryKey: "delivery-1",
    eventId: "evt-1",
    shopDomain: "example.myshopify.com",
    topic: "app/uninstalled",
    webhookId: "wh-1",
    subscriptionName: "primary",
    rawBody: "{\"id\":1}",
    hmacHeader: "hmac",
  };
}

test("prisma webhook inbox store enqueues new deliveries", async () => {
  const writes = [];
  const store = createPrismaWebhookInboxStore({
    webhookInbox: {
      async create({ data }) {
        writes.push(data);
      },
    },
  });

  const result = await store.enqueueIfAbsent(buildRecord());

  assert.equal(result, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].deliveryKey, "delivery-1");
});

test("prisma webhook inbox store treats unique conflicts as duplicate no-op", async () => {
  const store = createPrismaWebhookInboxStore({
    webhookInbox: {
      async create() {
        const error = new Error("duplicate");
        error.code = "P2002";
        throw error;
      },
    },
  });

  const result = await store.enqueueIfAbsent(buildRecord());

  assert.equal(result, false);
});

test("prisma webhook inbox store rethrows non-unique write failures", async () => {
  const store = createPrismaWebhookInboxStore({
    webhookInbox: {
      async create() {
        throw new Error("db unavailable");
      },
    },
  });

  await assert.rejects(() => store.enqueueIfAbsent(buildRecord()), /db unavailable/);
});
