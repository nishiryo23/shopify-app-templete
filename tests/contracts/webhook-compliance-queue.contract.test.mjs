import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createPrismaJobQueue } from "../../domain/jobs/prisma-job-queue.mjs";
import {
  buildWebhookShopRedactDedupeKey,
  enqueueOrFindActiveWebhookShopRedactJob,
  WEBHOOK_SHOP_REDACT_KIND,
} from "../../domain/webhooks/compliance-jobs.mjs";
import { runWebhookShopRedactJob } from "../../workers/webhook-compliance.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("shop redact enqueue reuses an active compliance job for duplicate deliveries", async () => {
  const jobs = [{
    attempts: 0,
    availableAt: new Date("2026-03-18T00:00:00.000Z"),
    createdAt: new Date("2026-03-18T00:00:00.000Z"),
    dedupeKey: buildWebhookShopRedactDedupeKey({ deliveryKey: "delivery-1" }),
    id: "job-existing",
    kind: WEBHOOK_SHOP_REDACT_KIND,
    payload: { deliveryKey: "delivery-1", requestedAt: "2026-03-18T00:00:00.000Z" },
    shopDomain: "example.myshopify.com",
    state: "queued",
  }];
  const prisma = {
    job: {
      async create() {
        const error = new Error("duplicate");
        error.code = "P2002";
        throw error;
      },
      async findFirst({ where }) {
        return jobs.find((job) =>
          job.shopDomain === where.shopDomain
          && job.kind === where.kind
          && job.dedupeKey === where.dedupeKey
          && where.state.in.includes(job.state),
        ) ?? null;
      },
    },
  };

  const job = await enqueueOrFindActiveWebhookShopRedactJob({
    deliveryKey: "delivery-1",
    jobQueue: createPrismaJobQueue(prisma),
    prisma,
    shopDomain: "example.myshopify.com",
  });

  assert.equal(job?.id, "job-existing");
});

test("shop redact worker erases shop data using the leased job payload", async () => {
  const calls = [];
  const result = await runWebhookShopRedactJob({
    artifactStorage: {
      async delete(objectKey) {
        calls.push(["delete", objectKey]);
        return true;
      },
    },
    job: {
      id: "job-redact-active",
      kind: WEBHOOK_SHOP_REDACT_KIND,
      payload: {
        deliveryKey: "delivery-1",
      },
      shopDomain: "example.myshopify.com",
    },
    now: new Date("2026-03-18T00:00:00.000Z"),
    prisma: {
      artifact: {
        async findMany() {
          return [];
        },
      },
      async $transaction(callback) {
        return callback({
          artifact: {
            async deleteMany() {
              calls.push(["artifact.deleteMany"]);
              return { count: 0 };
            },
          },
          job: {
            async deleteMany(args) {
              calls.push(["job.deleteMany", args]);
              return { count: 0 };
            },
          },
          jobLease: {
            async deleteMany(args) {
              calls.push(["jobLease.deleteMany", args]);
              return { count: 0 };
            },
          },
          session: {
            async deleteMany() {
              calls.push(["session.deleteMany"]);
              return { count: 0 };
            },
          },
          shop: {
            async deleteMany() {
              calls.push(["shop.deleteMany"]);
              return { count: 0 };
            },
          },
          webhookInbox: {
            async deleteMany() {
              calls.push(["webhookInbox.deleteMany"]);
              return { count: 0 };
            },
            async updateMany(args) {
              calls.push(["webhookInbox.updateMany", args]);
              return { count: 1 };
            },
          },
        });
      },
    },
  });

  assert.deepEqual(
    calls.find(([name]) => name === "webhookInbox.updateMany"),
    ["webhookInbox.updateMany", {
      data: {
        hmacHeader: null,
        processedAt: new Date("2026-03-18T00:00:00.000Z"),
        rawBody: null,
      },
      where: {
        deliveryKey: "delivery-1",
        shopDomain: "example.myshopify.com",
      },
    }],
  );
  assert.deepEqual(
    calls.find(([name]) => name === "job.deleteMany"),
    ["job.deleteMany", {
      where: {
        id: { not: "job-redact-active" },
        shopDomain: "example.myshopify.com",
      },
    }],
  );
  assert.deepEqual(
    calls.find(([name]) => name === "jobLease.deleteMany"),
    ["jobLease.deleteMany", {
      where: {
        jobId: { not: "job-redact-active" },
        shopDomain: "example.myshopify.com",
      },
    }],
  );
  assert.equal(result.deletedWebhookInboxRows, 0);
});

test("bootstrap worker leases and dispatches the queued shop redact job", () => {
  const bootstrap = readProjectFile("workers/bootstrap.mjs");

  assert.match(bootstrap, /WEBHOOK_SHOP_REDACT_KIND/);
  assert.match(bootstrap, /cleanupCompletedRedactJob/);
  assert.match(bootstrap, /kinds: PRIORITIZED_SYSTEM_JOB_KINDS/);
  assert.match(bootstrap, /kinds: ORDINARY_WORKER_JOB_KINDS/);
  assert.match(
    bootstrap,
    /if \(args\.job\?\.kind === WEBHOOK_SHOP_REDACT_KIND\) \{\s+return runWebhookShopRedactJob\(args\);/m,
  );
});
