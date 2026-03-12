import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWebhookDeliveryKey,
  computeWebhookHmac,
  createWebhookInboxStore,
  processWebhookIngress,
} from "../../domain/webhooks/inbox-contract.mjs";

const clientSecret = "shpss_test_secret";
const rawBody = JSON.stringify({ id: 1, topic: "app/uninstalled" });

function buildHeaders(overrides = {}) {
  return {
    "X-Shopify-Hmac-SHA256": computeWebhookHmac({ rawBody, clientSecret }),
    "X-Shopify-Event-Id": "evt-1",
    "X-Shopify-Shop-Domain": "example.myshopify.com",
    "X-Shopify-Topic": "app/uninstalled",
    "X-Shopify-Webhook-Id": "wh_1",
    ...overrides,
  };
}

test("invalid HMAC returns 401 with no side effects", async () => {
  const inbox = createWebhookInboxStore();
  const result = await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Hmac-SHA256": "invalid" }),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(result, {
    status: 401,
    outcome: "invalid-hmac",
    enqueued: false,
  });
  assert.equal(inbox.getWrites().length, 0);
});

test("first valid delivery is enqueued before 200", async () => {
  const inbox = createWebhookInboxStore();
  const result = await processWebhookIngress({
    headers: buildHeaders(),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(result, {
    status: 200,
    outcome: "accepted",
    enqueued: true,
  });
  assert.equal(inbox.getWrites().length, 1);
});

test("missing event id is rejected without enqueue", async () => {
  const inbox = createWebhookInboxStore();
  const result = await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Event-Id": undefined }),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(result, {
    status: 400,
    outcome: "missing-event-id",
    enqueued: false,
  });
  assert.equal(inbox.getWrites().length, 0);
});

test("missing shop domain is rejected without enqueue", async () => {
  const inbox = createWebhookInboxStore();
  const result = await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Shop-Domain": undefined }),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(result, {
    status: 400,
    outcome: "missing-shop-domain",
    enqueued: false,
  });
  assert.equal(inbox.getWrites().length, 0);
});

test("missing topic is rejected without enqueue", async () => {
  const inbox = createWebhookInboxStore();
  const result = await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Topic": undefined }),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(result, {
    status: 400,
    outcome: "missing-topic",
    enqueued: false,
  });
  assert.equal(inbox.getWrites().length, 0);
});

test("standard Headers instances are accepted", async () => {
  const inbox = createWebhookInboxStore();
  const result = await processWebhookIngress({
    headers: new Headers(buildHeaders()),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(result, {
    status: 200,
    outcome: "accepted",
    enqueued: true,
  });
  assert.equal(inbox.getWrites().length, 1);
});

test("duplicate webhook delivery is 200 no-op", async () => {
  const inbox = createWebhookInboxStore();

  await processWebhookIngress({
    headers: buildHeaders(),
    rawBody,
    clientSecret,
    inbox,
  });

  const duplicateResult = await processWebhookIngress({
    headers: buildHeaders(),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(duplicateResult, {
    status: 200,
    outcome: "duplicate-no-op",
    enqueued: false,
  });
  assert.equal(inbox.getWrites().length, 1);
});

test("concurrent duplicate deliveries remain single-write with atomic enqueue", async () => {
  let waiters = 0;
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const writes = [];
  const seenDeliveryKeys = new Set();
  const inbox = {
    async enqueueIfAbsent(record) {
      waiters += 1;

      if (waiters === 2) {
        releaseGate();
      }

      await gate;

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

  const [firstResult, secondResult] = await Promise.all([
    processWebhookIngress({
      headers: buildHeaders(),
      rawBody,
      clientSecret,
      inbox,
    }),
    processWebhookIngress({
      headers: buildHeaders(),
      rawBody,
      clientSecret,
      inbox,
    }),
  ]);

  assert.deepEqual(
    [firstResult.outcome, secondResult.outcome].sort(),
    ["accepted", "duplicate-no-op"],
  );
  assert.equal(inbox.getWrites().length, 1);
});

test("same event id with different subscription names is enqueued for each subscription", async () => {
  const inbox = createWebhookInboxStore();

  const firstResult = await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Name": "primary-subscription", "X-Shopify-Webhook-Id": "wh_1" }),
    rawBody,
    clientSecret,
    inbox,
  });

  const secondResult = await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Name": "secondary-subscription", "X-Shopify-Webhook-Id": "wh_2" }),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(firstResult, {
    status: 200,
    outcome: "accepted",
    enqueued: true,
  });
  assert.deepEqual(secondResult, {
    status: 200,
    outcome: "accepted",
    enqueued: true,
  });
  assert.equal(inbox.getWrites().length, 2);
});

test("same event id with different subscription names is enqueued for each subscription when webhook id is absent", async () => {
  const inbox = createWebhookInboxStore();

  await processWebhookIngress({
    headers: buildHeaders({
      "X-Shopify-Name": "primary-subscription",
      "X-Shopify-Webhook-Id": undefined,
    }),
    rawBody,
    clientSecret,
    inbox,
  });

  const secondResult = await processWebhookIngress({
    headers: buildHeaders({
      "X-Shopify-Name": "secondary-subscription",
      "X-Shopify-Webhook-Id": undefined,
    }),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(secondResult, {
    status: 200,
    outcome: "accepted",
    enqueued: true,
  });
  assert.equal(inbox.getWrites().length, 2);
});

test("same event id with same subscription name but different webhook ids is duplicate", async () => {
  const inbox = createWebhookInboxStore();

  await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Name": "products-subscription", "X-Shopify-Webhook-Id": "wh_1" }),
    rawBody,
    clientSecret,
    inbox,
  });

  const secondResult = await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Name": "products-subscription", "X-Shopify-Webhook-Id": "wh_2" }),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(secondResult, {
    status: 200,
    outcome: "duplicate-no-op",
    enqueued: false,
  });
  assert.equal(inbox.getWrites().length, 1);
});

test("same event id with same subscription name is duplicate when webhook id is absent", async () => {
  const inbox = createWebhookInboxStore();

  await processWebhookIngress({
    headers: buildHeaders({
      "X-Shopify-Name": "products-subscription",
      "X-Shopify-Webhook-Id": undefined,
    }),
    rawBody,
    clientSecret,
    inbox,
  });

  const duplicateResult = await processWebhookIngress({
    headers: buildHeaders({
      "X-Shopify-Name": "products-subscription",
      "X-Shopify-Webhook-Id": undefined,
    }),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(duplicateResult, {
    status: 200,
    outcome: "duplicate-no-op",
    enqueued: false,
  });
  assert.equal(inbox.getWrites().length, 1);
});

test("same event id with different webhook ids is accepted when subscription names are absent", async () => {
  const inbox = createWebhookInboxStore();

  await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Webhook-Id": "wh_1" }),
    rawBody,
    clientSecret,
    inbox,
  });

  const secondResult = await processWebhookIngress({
    headers: buildHeaders({ "X-Shopify-Webhook-Id": "wh_2" }),
    rawBody,
    clientSecret,
    inbox,
  });

  assert.deepEqual(secondResult, {
    status: 200,
    outcome: "accepted",
    enqueued: true,
  });
  assert.equal(inbox.getWrites().length, 2);
});

test("delivery key scopes by shop topic event and prefers subscription name over webhook id", () => {
  assert.equal(
    buildWebhookDeliveryKey({
      shopDomain: "example.myshopify.com",
      topic: "products/update",
      eventId: "evt-1",
      webhookId: "wh_1",
      subscriptionName: "products-primary",
    }),
    JSON.stringify([
      "example.myshopify.com",
      "products/update",
      "evt-1",
      "products-primary",
    ]),
  );
  assert.equal(
    buildWebhookDeliveryKey({
      shopDomain: "example.myshopify.com",
      topic: "products/update",
      eventId: "evt-1",
      subscriptionName: "subscription-name",
    }),
    JSON.stringify([
      "example.myshopify.com",
      "products/update",
      "evt-1",
      "subscription-name",
    ]),
  );
});
