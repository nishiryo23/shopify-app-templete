import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildMetadataOnlyWebhookInboxData,
  COMPLIANCE_TOPICS,
  eraseShopData,
  isComplianceTopic,
} from "../../domain/webhooks/compliance.server.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("compliance topic helper matches all mandatory Shopify webhook topics", () => {
  assert.deepEqual(COMPLIANCE_TOPICS, [
    "customers/data_request",
    "customers/redact",
    "shop/redact",
  ]);
  assert.equal(isComplianceTopic("customers/data_request"), true);
  assert.equal(isComplianceTopic("customers/redact"), true);
  assert.equal(isComplianceTopic("shop/redact"), true);
  assert.equal(isComplianceTopic("app/uninstalled"), false);
});

test("compliance webhook handling preserves Shopify topic underscores while keeping scopes update compatibility", () => {
  const handler = readProjectFile("domain/webhooks/enqueue.server.ts");

  assert.match(handler, /function normalizeTopic\(topic: string\) \{\s+return topic\.toLowerCase\(\);\s+\}/m);
  assert.match(
    handler,
    /function isScopesUpdateTopic\(topic: string\) \{\s+return topic === "app\/scopes_update" \|\| topic === "app\/scopes\/update";\s+\}/m,
  );
  assert.match(handler, /if \(isComplianceTopic\(normalizedTopic\)\) \{/);
});

test("metadata-only inbox payload helper clears raw payload and preserves processedAt", () => {
  const processedAt = new Date("2026-03-18T00:00:00.000Z");

  assert.deepEqual(buildMetadataOnlyWebhookInboxData({ processedAt }), {
    hmacHeader: null,
    processedAt,
    rawBody: null,
  });
});

test("shop redact erases shop-bound artifacts and persisted shop state", async () => {
  const deletedObjectKeys = [];
  const deleted = [];

  const result = await eraseShopData({
    artifactStorage: {
      async delete(objectKey) {
        deletedObjectKeys.push(objectKey);
        return true;
      },
    },
    prisma: {
      artifact: {
        async findMany({ where }) {
          assert.deepEqual(where, { shopDomain: "example.myshopify.com" });
          return [
            { id: "artifact-1", objectKey: "artifacts/shop-1/a.json" },
            { id: "artifact-2", objectKey: "artifacts/shop-1/b.json" },
          ];
        },
      },
      async $transaction(callback) {
        return callback({
          artifact: {
            async deleteMany(args) {
              deleted.push(["artifact", args]);
              return { count: 2 };
            },
          },
          job: {
            async deleteMany(args) {
              deleted.push(["job", args]);
              return { count: 3 };
            },
          },
          jobLease: {
            async deleteMany(args) {
              deleted.push(["jobLease", args]);
              return { count: 1 };
            },
          },
          session: {
            async deleteMany(args) {
              deleted.push(["session", args]);
              return { count: 4 };
            },
          },
          shop: {
            async deleteMany(args) {
              deleted.push(["shop", args]);
              return { count: 1 };
            },
          },
          webhookInbox: {
            async deleteMany(args) {
              deleted.push(["webhookInbox", args]);
              return { count: 5 };
            },
          },
        });
      },
    },
    shopDomain: "example.myshopify.com",
  });

  assert.deepEqual(deletedObjectKeys, [
    "artifacts/shop-1/a.json",
    "artifacts/shop-1/b.json",
  ]);
  assert.deepEqual(
    deleted.map(([name, args]) => [name, args.where]),
    [
      ["artifact", { shopDomain: "example.myshopify.com" }],
      ["job", { shopDomain: "example.myshopify.com" }],
      ["jobLease", { shopDomain: "example.myshopify.com" }],
      ["session", { shop: "example.myshopify.com" }],
      ["shop", { shopDomain: "example.myshopify.com" }],
      ["webhookInbox", { shopDomain: "example.myshopify.com" }],
    ],
  );
  assert.deepEqual(result, {
    deletedArtifacts: 2,
    deletedJobLeases: 1,
    deletedJobs: 3,
    deletedSessions: 4,
    deletedShopStates: 1,
    deletedWebhookInboxRows: 5,
  });
});

test("shop redact restores deleted artifacts when the database purge fails", async () => {
  const deletedObjectKeys = [];
  const restoredArtifacts = [];

  await assert.rejects(
    eraseShopData({
      artifactStorage: {
        async delete(objectKey) {
          deletedObjectKeys.push(objectKey);
          return true;
        },
        async get(objectKey) {
          return Buffer.from(`body:${objectKey}`, "utf8");
        },
        async put(args) {
          restoredArtifacts.push(args);
          return true;
        },
      },
      prisma: {
        artifact: {
          async findMany() {
            return [
              {
                contentType: "application/json",
                id: "artifact-1",
                metadata: { source: "a" },
                objectKey: "artifacts/shop-1/a.json",
                visibility: "private",
              },
              {
                contentType: "application/json",
                id: "artifact-2",
                metadata: { source: "b" },
                objectKey: "artifacts/shop-1/b.json",
                visibility: "private",
              },
            ];
          },
        },
        async $transaction() {
          throw new Error("db-purge-failed");
        },
      },
      shopDomain: "example.myshopify.com",
    }),
    /db-purge-failed/,
  );

  assert.deepEqual(deletedObjectKeys, [
    "artifacts/shop-1/a.json",
    "artifacts/shop-1/b.json",
  ]);
  assert.deepEqual(restoredArtifacts, [
    {
      body: Buffer.from("body:artifacts/shop-1/b.json", "utf8"),
      contentType: "application/json",
      metadata: { source: "b" },
      objectKey: "artifacts/shop-1/b.json",
      visibility: "private",
    },
    {
      body: Buffer.from("body:artifacts/shop-1/a.json", "utf8"),
      contentType: "application/json",
      metadata: { source: "a" },
      objectKey: "artifacts/shop-1/a.json",
      visibility: "private",
    },
  ]);
});

test("shop redact restores already-deleted artifacts when a later external delete fails", async () => {
  const deletedObjectKeys = [];
  const restoredArtifacts = [];

  await assert.rejects(
    eraseShopData({
      artifactStorage: {
        async delete(objectKey) {
          deletedObjectKeys.push(objectKey);
          if (objectKey.endsWith("/b.json")) {
            throw new Error("artifact-delete-failed");
          }
          return true;
        },
        async get(objectKey) {
          return Buffer.from(`body:${objectKey}`, "utf8");
        },
        async put(args) {
          restoredArtifacts.push(args);
          return true;
        },
      },
      prisma: {
        artifact: {
          async findMany() {
            return [
              {
                contentType: "application/json",
                id: "artifact-1",
                metadata: { source: "a" },
                objectKey: "artifacts/shop-1/a.json",
                visibility: "private",
              },
              {
                contentType: "application/json",
                id: "artifact-2",
                metadata: { source: "b" },
                objectKey: "artifacts/shop-1/b.json",
                visibility: "private",
              },
            ];
          },
        },
        async $transaction() {
          throw new Error("transaction-should-not-run");
        },
      },
      shopDomain: "example.myshopify.com",
    }),
    /artifact-delete-failed/,
  );

  assert.deepEqual(deletedObjectKeys, [
    "artifacts/shop-1/a.json",
    "artifacts/shop-1/b.json",
  ]);
  assert.deepEqual(restoredArtifacts, [
    {
      body: Buffer.from("body:artifacts/shop-1/b.json", "utf8"),
      contentType: "application/json",
      metadata: { source: "b" },
      objectKey: "artifacts/shop-1/b.json",
      visibility: "private",
    },
    {
      body: Buffer.from("body:artifacts/shop-1/a.json", "utf8"),
      contentType: "application/json",
      metadata: { source: "a" },
      objectKey: "artifacts/shop-1/a.json",
      visibility: "private",
    },
  ]);
});

test("shop redact still restores deleted artifacts after the lease fence is lost", async () => {
  const restoredArtifacts = [];
  let assertCalls = 0;

  await assert.rejects(
    eraseShopData({
      artifactStorage: {
        async delete() {
          return true;
        },
        async get(objectKey) {
          return Buffer.from(`body:${objectKey}`, "utf8");
        },
        async put(args) {
          restoredArtifacts.push(args);
          return true;
        },
      },
      assertJobLeaseActive() {
        assertCalls += 1;
        if (assertCalls >= 5) {
          throw new Error("job-lease-lost");
        }
      },
      prisma: {
        artifact: {
          async findMany() {
            return [
              {
                contentType: "application/json",
                id: "artifact-1",
                metadata: { source: "a" },
                objectKey: "artifacts/shop-1/a.json",
                visibility: "private",
              },
              {
                contentType: "application/json",
                id: "artifact-2",
                metadata: { source: "b" },
                objectKey: "artifacts/shop-1/b.json",
                visibility: "private",
              },
            ];
          },
        },
        async $transaction() {
          throw new Error("transaction-should-not-run");
        },
      },
      shopDomain: "example.myshopify.com",
    }),
    /job-lease-lost/,
  );

  assert.deepEqual(restoredArtifacts, [
    {
      body: Buffer.from("body:artifacts/shop-1/b.json", "utf8"),
      contentType: "application/json",
      metadata: { source: "b" },
      objectKey: "artifacts/shop-1/b.json",
      visibility: "private",
    },
    {
      body: Buffer.from("body:artifacts/shop-1/a.json", "utf8"),
      contentType: "application/json",
      metadata: { source: "a" },
      objectKey: "artifacts/shop-1/a.json",
      visibility: "private",
    },
  ]);
});

test("shop redact preserves the current delivery as a processed metadata-only inbox row", async () => {
  const deleted = [];
  const updated = [];
  const processedAt = new Date("2026-03-18T00:00:00.000Z");

  await eraseShopData({
    artifactStorage: {
      async delete() {
        return true;
      },
    },
    preserveDeliveryKey: "delivery-1",
    prisma: {
      artifact: {
        async findMany() {
          return [];
        },
      },
      async $transaction(callback) {
        return callback({
          artifact: {
            async deleteMany(args) {
              deleted.push(["artifact", args]);
              return { count: 0 };
            },
          },
          job: {
            async deleteMany(args) {
              deleted.push(["job", args]);
              return { count: 0 };
            },
          },
          jobLease: {
            async deleteMany(args) {
              deleted.push(["jobLease", args]);
              return { count: 0 };
            },
          },
          session: {
            async deleteMany(args) {
              deleted.push(["session", args]);
              return { count: 0 };
            },
          },
          shop: {
            async deleteMany(args) {
              deleted.push(["shop", args]);
              return { count: 0 };
            },
          },
          webhookInbox: {
            async deleteMany(args) {
              deleted.push(["webhookInbox", args]);
              return { count: 4 };
            },
            async updateMany(args) {
              updated.push(args);
              return { count: 1 };
            },
          },
        });
      },
    },
    processedAt,
    shopDomain: "example.myshopify.com",
  });

  assert.deepEqual(updated, [{
    data: {
      hmacHeader: null,
      processedAt,
      rawBody: null,
    },
    where: {
      deliveryKey: "delivery-1",
      shopDomain: "example.myshopify.com",
    },
  }]);
  assert.deepEqual(
    deleted.find(([name]) => name === "webhookInbox"),
    ["webhookInbox", {
      where: {
        deliveryKey: { not: "delivery-1" },
        shopDomain: "example.myshopify.com",
      },
    }],
  );
});

test("shop redact can preserve the active compliance job and lease until finalization", async () => {
  const deleted = [];

  await eraseShopData({
    artifactStorage: {
      async delete() {
        return true;
      },
    },
    preserveJobId: "job-redact-active",
    prisma: {
      artifact: {
        async findMany() {
          return [];
        },
      },
      async $transaction(callback) {
        return callback({
          artifact: {
            async deleteMany(args) {
              deleted.push(["artifact", args]);
              return { count: 0 };
            },
          },
          job: {
            async deleteMany(args) {
              deleted.push(["job", args]);
              return { count: 2 };
            },
          },
          jobLease: {
            async deleteMany(args) {
              deleted.push(["jobLease", args]);
              return { count: 0 };
            },
          },
          session: {
            async deleteMany(args) {
              deleted.push(["session", args]);
              return { count: 0 };
            },
          },
          shop: {
            async deleteMany(args) {
              deleted.push(["shop", args]);
              return { count: 0 };
            },
          },
          webhookInbox: {
            async deleteMany(args) {
              deleted.push(["webhookInbox", args]);
              return { count: 0 };
            },
          },
        });
      },
    },
    shopDomain: "example.myshopify.com",
  });

  assert.deepEqual(
    deleted.map(([name, args]) => [name, args.where]),
    [
      ["artifact", { shopDomain: "example.myshopify.com" }],
      ["job", { id: { not: "job-redact-active" }, shopDomain: "example.myshopify.com" }],
      ["jobLease", { jobId: { not: "job-redact-active" }, shopDomain: "example.myshopify.com" }],
      ["session", { shop: "example.myshopify.com" }],
      ["shop", { shopDomain: "example.myshopify.com" }],
      ["webhookInbox", { shopDomain: "example.myshopify.com" }],
    ],
  );
});
