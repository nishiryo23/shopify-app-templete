import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { Session } from "@shopify/shopify-app-react-router/server";

import {
  buildProductExportArtifacts,
  createProductExportCsvBuilder,
  mapProductNodeToExportRow,
} from "../../domain/products/export-csv.mjs";
import {
  buildActiveProductExportWhere,
  enqueueOrFindActiveProductExportJob,
  enqueueProductExportJob,
  findActiveProductExportJob,
  findLatestProductExportJob,
} from "../../domain/products/export-jobs.mjs";
import {
  PRODUCT_CORE_SEO_EXPORT_HEADERS,
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_EXPORT_FORMAT,
  PRODUCT_EXPORT_KIND,
} from "../../domain/products/export-profile.mjs";
import {
  readProductPagesForExport,
  readProductsForExport,
} from "../../platform/shopify/product-export.server.mjs";
import { JobLeaseLostError } from "../../workers/bootstrap.mjs";
import {
  createWorkerShopSessionStorage,
  MissingOfflineSessionError,
  resetWorkerOfflineAdminCaches,
} from "../../workers/offline-admin.mjs";
import { runProductExportJob } from "../../workers/product-export.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("product export CSV profile keeps product core plus SEO headers", () => {
  const products = [{
    descriptionHtml: "<p>Body</p>",
    handle: "sample-product",
    id: "gid://shopify/Product/1",
    productType: "Hat",
    seo: {
      description: "SEO description",
      title: "SEO title",
    },
    status: "ACTIVE",
    tags: ["summer", "sale"],
    title: "Sample Product",
    updatedAt: "2026-03-13T00:00:00Z",
    vendor: "Matri",
  }];
  const { csvText, manifest, rowCount } = buildProductExportArtifacts({
    products,
    signingKey: "test-signing-key",
  });

  assert.equal(rowCount, 1);
  assert.equal(csvText.split("\n")[0], PRODUCT_CORE_SEO_EXPORT_HEADERS.join(","));
  assert.match(csvText, /SEO title/);
  assert.match(csvText, /SEO description/);
  assert.equal(manifest.rowFingerprints.length, 2);
});

test("product export CSV builder appends pages without buffering prior rows", () => {
  const builder = createProductExportCsvBuilder({
    signingKey: "test-signing-key",
  });

  const firstChunk = builder.appendProducts([{
    descriptionHtml: "<p>One</p>",
    handle: "sample-product-1",
    id: "gid://shopify/Product/1",
    productType: "Hat",
    seo: {
      description: "SEO description 1",
      title: "SEO title 1",
    },
    status: "ACTIVE",
    tags: ["summer"],
    title: "Sample Product 1",
    updatedAt: "2026-03-13T00:00:00Z",
    vendor: "Matri",
  }]);
  const secondChunk = builder.appendProducts([{
    descriptionHtml: "<p>Two</p>",
    handle: "sample-product-2",
    id: "gid://shopify/Product/2",
    productType: "Bag",
    seo: {
      description: "SEO description 2",
      title: "SEO title 2",
    },
    status: "DRAFT",
    tags: ["new"],
    title: "Sample Product 2",
    updatedAt: "2026-03-13T00:00:01Z",
    vendor: "Matri",
  }]);
  const { manifest, rowCount } = builder.finalize();

  assert.equal(firstChunk.split("\n")[0], PRODUCT_CORE_SEO_EXPORT_HEADERS.join(","));
  assert.equal(secondChunk.split("\n")[0], "gid://shopify/Product/2,sample-product-2,Sample Product 2,DRAFT,Matri,Bag,new,<p>Two</p>,SEO title 2,SEO description 2,2026-03-13T00:00:01Z");
  assert.equal(rowCount, 2);
  assert.equal(manifest.rowFingerprints.length, 3);
});

test("product export job lookup uses active states only", async () => {
  const calls = [];
  const prisma = {
    job: {
      async findFirst(args) {
        calls.push(args);
        return { id: "job-1", state: "queued" };
      },
    },
  };

  const job = await findActiveProductExportJob({
    prisma,
    shopDomain: "example.myshopify.com",
  });

  assert.equal(job.id, "job-1");
  assert.deepEqual(
    calls[0].where,
    buildActiveProductExportWhere({
      shopDomain: "example.myshopify.com",
    }),
  );
});

test("product export latest job lookup can recover after duplicate enqueue race", async () => {
  const calls = [];
  const prisma = {
    job: {
      async findFirst(args) {
        calls.push(args);
        return { id: "job-2", state: "completed" };
      },
    },
  };

  const job = await findLatestProductExportJob({
    prisma,
    shopDomain: "example.myshopify.com",
  });

  assert.equal(job.id, "job-2");
  assert.deepEqual(calls[0].where, {
    dedupeKey: "product-export:product-core-seo-v1:csv",
    kind: PRODUCT_EXPORT_KIND,
    shopDomain: "example.myshopify.com",
  });
});

test("product export enqueue fixes dedupe key and max attempts", async () => {
  const calls = [];
  const jobQueue = {
    async enqueue(args) {
      calls.push(args);
      return { id: "job-1", state: "queued", ...args };
    },
  };

  const job = await enqueueProductExportJob({
    jobQueue,
    shopDomain: "example.myshopify.com",
  });

  assert.equal(job.kind, PRODUCT_EXPORT_KIND);
  assert.equal(job.maxAttempts, 1);
  assert.equal(job.payload.profile, PRODUCT_CORE_SEO_EXPORT_PROFILE);
  assert.equal(job.payload.format, PRODUCT_EXPORT_FORMAT);
  assert.equal(calls[0].dedupeKey, "product-export:product-core-seo-v1:csv");
});

test("product export enqueue returns null when duplicate race closes the active window before a new active job exists", async () => {
  const enqueueCalls = [];
  const prismaCalls = [];
  const jobQueue = {
    async enqueue(args) {
      enqueueCalls.push(args);

      if (enqueueCalls.length === 1) {
        return null;
      }

      return null;
    },
  };
  const prisma = {
    job: {
      async findFirst(args) {
        prismaCalls.push(args);
        return null;
      },
    },
  };

  const job = await enqueueOrFindActiveProductExportJob({
    jobQueue,
    prisma,
    shopDomain: "example.myshopify.com",
  });

  assert.equal(job, null);
  assert.equal(enqueueCalls.length, 2);
  assert.equal(prismaCalls.length, 2);
  assert.deepEqual(prismaCalls[0].where, buildActiveProductExportWhere({
    shopDomain: "example.myshopify.com",
  }));
  assert.deepEqual(prismaCalls[1].where, buildActiveProductExportWhere({
    shopDomain: "example.myshopify.com",
  }));
});

test("product export enqueue returns an active job when the second duplicate race is owned by another request", async () => {
  const enqueueCalls = [];
  const prismaCalls = [];
  const jobQueue = {
    async enqueue(args) {
      enqueueCalls.push(args);
      return null;
    },
  };
  const prisma = {
    job: {
      async findFirst(args) {
        prismaCalls.push(args);

        if (prismaCalls.length === 1) {
          return null;
        }

        return { id: "job-2", state: "queued" };
      },
    },
  };

  const job = await enqueueOrFindActiveProductExportJob({
    jobQueue,
    prisma,
    shopDomain: "example.myshopify.com",
  });

  assert.equal(job.id, "job-2");
  assert.equal(enqueueCalls.length, 2);
  assert.equal(prismaCalls.length, 2);
});

test("product export Shopify reader paginates until the last page", async () => {
  const cursors = [];
  const admin = {
    async graphql(_query, { variables }) {
      cursors.push(variables.after ?? null);

      if (!variables.after) {
        return Response.json({
          data: {
            products: {
              edges: [{
                cursor: "cursor-1",
                node: { id: "gid://shopify/Product/1", title: "One" },
              }],
              pageInfo: {
                endCursor: "cursor-1",
                hasNextPage: true,
              },
            },
          },
        });
      }

      return Response.json({
        data: {
          products: {
            edges: [{
              cursor: "cursor-2",
              node: { id: "gid://shopify/Product/2", title: "Two" },
            }],
            pageInfo: {
              endCursor: "cursor-2",
              hasNextPage: false,
            },
          },
        },
      });
    },
  };

  const products = await readProductsForExport(admin);

  assert.deepEqual(cursors, [null, "cursor-1"]);
  assert.deepEqual(products.map((product) => product.id), [
    "gid://shopify/Product/1",
    "gid://shopify/Product/2",
  ]);
});

test("product export Shopify page reader stops before the next fetch after lease loss", async () => {
  const cursors = [];
  let leaseChecks = 0;
  const admin = {
    async graphql(_query, { variables }) {
      cursors.push(variables.after ?? null);

      return Response.json({
        data: {
          products: {
            edges: [{
              cursor: "cursor-1",
              node: { id: "gid://shopify/Product/1", title: "One" },
            }],
            pageInfo: {
              endCursor: "cursor-1",
              hasNextPage: true,
            },
          },
        },
      });
    },
  };

  await assert.rejects(
    async () => {
      for await (const page of readProductPagesForExport(admin, {
        assertJobLeaseActive() {
          leaseChecks += 1;
          if (leaseChecks >= 3) {
            throw new JobLeaseLostError("job-1");
          }
        },
      })) {
        void page;
      }
    },
    /job-lease-lost:job-1/,
  );

  assert.deepEqual(cursors, [null]);
});

test("product export worker stores source and manifest artifacts on success", async () => {
  const records = [];
  const puts = [];
  const storage = {
    async putFile(args) {
      puts.push({ ...args, mode: "file" });
      return {
        bucket: "artifacts",
        checksumSha256: `sha-${puts.length}`,
        contentType: args.contentType,
        metadata: args.metadata,
        objectKey: args.key,
        sizeBytes: 128,
        visibility: "private",
      };
    },
    async put(args) {
      puts.push({ ...args, mode: "body" });
      return {
        bucket: "artifacts",
        checksumSha256: `sha-${puts.length}`,
        contentType: args.contentType,
        metadata: args.metadata,
        objectKey: args.key,
        sizeBytes: Buffer.byteLength(args.body),
        visibility: "private",
      };
    },
    async delete() {
      return true;
    },
  };
  const catalog = {
    async record(args) {
      records.push(args);
      return { id: `artifact-${records.length}`, ...args };
    },
    async markDeleted() {
      return true;
    },
  };

  const result = await runProductExportJob({
    artifactCatalog: catalog,
    artifactKeyPrefix: "resolved-prefix",
    artifactStorage: storage,
    job: {
      id: "job-1",
      payload: {},
      shopDomain: "example.myshopify.com",
    },
    prisma: {},
    async *readProductPages() {
      yield [{
        descriptionHtml: "<p>Body</p>",
        handle: "sample-product",
        id: "gid://shopify/Product/1",
        productType: "Hat",
        seo: { description: "SEO description", title: "SEO title" },
        status: "ACTIVE",
        tags: ["summer"],
        title: "Sample Product",
        updatedAt: "2026-03-13T00:00:00Z",
        vendor: "Matri",
      }];
    },
    resolveAdminContext: async () => ({ admin: {} }),
    signingKey: "test-signing-key",
  });

  assert.equal(result.rowCount, 1);
  assert.equal(records.length, 2);
  assert.equal(records[0].kind, "product.export.source");
  assert.equal(records[1].kind, "product.export.manifest");
  assert.equal(puts[0].metadata.profile, PRODUCT_CORE_SEO_EXPORT_PROFILE);
  assert.equal(puts[0].mode, "file");
  assert.equal(puts[0].key, "resolved-prefix/product-exports/example.myshopify.com/job-1/source.csv");
  assert.equal(puts[1].key, "resolved-prefix/product-exports/example.myshopify.com/job-1/manifest.json");
});

test("product export worker compensates storage and catalog when manifest catalog record fails", async () => {
  const deletedStorageKeys = [];
  const deletedCatalogKeys = [];
  let recordCount = 0;
  const storage = {
    async put(args) {
      return {
        bucket: "artifacts",
        checksumSha256: `sha-${args.key}`,
        contentType: args.contentType,
        metadata: args.metadata,
        objectKey: args.key,
        sizeBytes: Buffer.byteLength(args.body),
        visibility: "private",
      };
    },
    async delete(key) {
      deletedStorageKeys.push(key.objectKey);
      return true;
    },
  };
  const catalog = {
    async record(args) {
      recordCount += 1;
      if (recordCount === 2) {
        throw new Error("catalog failed");
      }

      return { id: "artifact-source", ...args };
    },
    async markDeleted(args) {
      deletedCatalogKeys.push(`${args.bucket}:${args.objectKey}`);
      return true;
    },
  };

  await assert.rejects(
    () => runProductExportJob({
      artifactCatalog: catalog,
      artifactStorage: storage,
      job: {
        id: "job-1",
        payload: {},
        shopDomain: "example.myshopify.com",
      },
      prisma: {},
      async *readProductPages() {
        yield [{
          descriptionHtml: "<p>Body</p>",
          handle: "sample-product",
          id: "gid://shopify/Product/1",
          productType: "Hat",
          seo: { description: "SEO description", title: "SEO title" },
          status: "ACTIVE",
          tags: ["summer"],
          title: "Sample Product",
          updatedAt: "2026-03-13T00:00:00Z",
          vendor: "Matri",
        }];
      },
      resolveAdminContext: async () => ({ admin: {} }),
      signingKey: "test-signing-key",
    }),
    /catalog failed/,
  );

  assert.equal(deletedStorageKeys.length, 2);
  assert.equal(deletedCatalogKeys.length, 1);
});

test("product export worker attempts all compensating cleanup steps even when one cleanup call fails", async () => {
  const cleanupCalls = [];
  let recordCount = 0;
  const storage = {
    async put(args) {
      return {
        bucket: "artifacts",
        checksumSha256: `sha-${args.key}`,
        contentType: args.contentType,
        metadata: args.metadata,
        objectKey: args.key,
        sizeBytes: Buffer.byteLength(args.body),
        visibility: "private",
      };
    },
    async delete(key) {
      cleanupCalls.push(`delete:${key.objectKey}`);
      if (key.objectKey.endsWith("source.csv")) {
        throw new Error("source delete failed");
      }

      return true;
    },
  };
  const catalog = {
    async record(args) {
      recordCount += 1;
      if (recordCount === 2) {
        throw new Error("catalog failed");
      }

      return { id: "artifact-source", ...args };
    },
    async markDeleted(args) {
      cleanupCalls.push(`markDeleted:${args.objectKey}`);
      if (args.objectKey.endsWith("source.csv")) {
        throw new Error("source markDeleted failed");
      }

      return true;
    },
  };

  await assert.rejects(
    () => runProductExportJob({
      artifactCatalog: catalog,
      artifactStorage: storage,
      job: {
        id: "job-1",
        payload: {},
        shopDomain: "example.myshopify.com",
      },
      prisma: {},
      async *readProductPages() {
        yield [{
          descriptionHtml: "<p>Body</p>",
          handle: "sample-product",
          id: "gid://shopify/Product/1",
          productType: "Hat",
          seo: { description: "SEO description", title: "SEO title" },
          status: "ACTIVE",
          tags: ["summer"],
          title: "Sample Product",
          updatedAt: "2026-03-13T00:00:00Z",
          vendor: "Matri",
        }];
      },
      resolveAdminContext: async () => ({ admin: {} }),
      signingKey: "test-signing-key",
    }),
    /catalog failed/,
  );

  assert.deepEqual(cleanupCalls, [
    "markDeleted:product-exports/example.myshopify.com/job-1/source.csv",
    "delete:product-exports/example.myshopify.com/job-1/source.csv",
    "delete:product-exports/example.myshopify.com/job-1/manifest.json",
  ]);
});

test("product export worker fences artifact writes after lease loss", async () => {
  const deletedStorageKeys = [];
  const puts = [];
  let pageReads = 0;
  const storage = {
    async put(args) {
      puts.push(args);
      return {
        bucket: "artifacts",
        checksumSha256: `sha-${args.key}`,
        contentType: args.contentType,
        metadata: args.metadata,
        objectKey: args.key,
        sizeBytes: Buffer.byteLength(args.body),
        visibility: "private",
      };
    },
    async delete(key) {
      deletedStorageKeys.push(key.objectKey);
      return true;
    },
  };

  await assert.rejects(
    () => runProductExportJob({
      artifactCatalog: {
        async record() {
          throw new Error("should not record after lease loss");
        },
        async markDeleted() {
          return true;
        },
      },
      artifactKeyPrefix: "resolved-prefix",
      artifactStorage: storage,
      job: {
        id: "job-1",
        payload: {},
        shopDomain: "example.myshopify.com",
      },
      prisma: {},
      async *readProductPages(_admin, { assertJobLeaseActive }) {
        pageReads += 1;
        yield [{
          descriptionHtml: "<p>Body</p>",
          handle: "sample-product",
          id: "gid://shopify/Product/1",
          productType: "Hat",
          seo: { description: "SEO description", title: "SEO title" },
          status: "ACTIVE",
          tags: ["summer"],
          title: "Sample Product",
          updatedAt: "2026-03-13T00:00:00Z",
          vendor: "Matri",
        }];
        assertJobLeaseActive();
        pageReads += 1;
      },
      assertJobLeaseActive() {
        throw new JobLeaseLostError("job-1");
      },
      resolveAdminContext: async () => ({ admin: {} }),
      signingKey: "test-signing-key",
    }),
    /job-lease-lost:job-1/,
  );

  assert.equal(pageReads, 1);
  assert.equal(puts.length, 0);
  assert.deepEqual(deletedStorageKeys, []);
});

test("product export worker marks missing offline session with stable error code", async () => {
  let capturedError = null;

  await assert.rejects(
    async () => runProductExportJob({
      artifactCatalog: {
        async record() {
          throw new Error("should not record");
        },
        async markDeleted() {
          return true;
        },
      },
      artifactStorage: {
        async put() {
          throw new Error("should not write");
        },
        async delete() {
          return true;
        },
      },
      job: {
        id: "job-1",
        payload: {},
        shopDomain: "example.myshopify.com",
      },
      prisma: {},
      async *readProductPages() {},
      resolveAdminContext: async () => {
        throw new MissingOfflineSessionError("example.myshopify.com");
      },
      signingKey: "test-signing-key",
    }),
    (error) => {
      capturedError = error;
      return true;
    },
  );

  assert.equal(capturedError.code, "missing-offline-session");
});

test("worker shop session storage falls back to legacy Prisma sessions when encryption key is unset", async () => {
  const legacySession = { id: "offline_example", isOnline: false, shop: "example.myshopify.com" };
  const storage = createWorkerShopSessionStorage({
    shop: {
      async findUnique() {
        return {
          encryptedOfflineSession: {
            ciphertext: "invalid",
            iv: "invalid",
            tag: "invalid",
          },
          offlineSessionId: "offline_example",
        };
      },
      async updateMany() {
        throw new Error("should not clear encrypted payload without a key");
      },
    },
  }, {
    onlineStorage: {
      async findSessionsByShop() {
        return [legacySession];
      },
      isReady() {
        return true;
      },
    },
  });

  const originalKey = process.env.SHOP_TOKEN_ENCRYPTION_KEY;
  delete process.env.SHOP_TOKEN_ENCRYPTION_KEY;
  resetWorkerOfflineAdminCaches();

  const sessions = await storage.findSessionsByShop("example.myshopify.com");

  if (originalKey === undefined) {
    delete process.env.SHOP_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.SHOP_TOKEN_ENCRYPTION_KEY = originalKey;
  }
  resetWorkerOfflineAdminCaches();
  assert.deepEqual(sessions, [legacySession]);
});

test("worker shop session storage falls back to legacy Prisma writes when encryption key is unset", async () => {
  const originalKey = process.env.SHOP_TOKEN_ENCRYPTION_KEY;
  delete process.env.SHOP_TOKEN_ENCRYPTION_KEY;
  resetWorkerOfflineAdminCaches();

  const calls = [];
  const storage = createWorkerShopSessionStorage({
    shop: {
      async upsert() {
        calls.push("shop.upsert");
        return true;
      },
    },
  }, {
    onlineStorage: {
      async storeSession(session) {
        calls.push(["online.storeSession", session.id]);
        return true;
      },
      async deleteSession(id) {
        calls.push(["online.deleteSession", id]);
        return true;
      },
      isReady() {
        return true;
      },
    },
  });

  const session = new Session({
    id: "offline_example.myshopify.com",
    isOnline: false,
    shop: "example.myshopify.com",
    state: "state",
    accessToken: "shpat_test_token",
    scope: "read_products",
  });

  await storage.storeSession(session);

  if (originalKey === undefined) {
    delete process.env.SHOP_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.SHOP_TOKEN_ENCRYPTION_KEY = originalKey;
  }
  resetWorkerOfflineAdminCaches();

  assert.deepEqual(calls, [["online.storeSession", "offline_example.myshopify.com"]]);
});

test("worker shop session storage keeps offline tokens out of the legacy session table when encryption is enabled", async () => {
  const originalKey = process.env.SHOP_TOKEN_ENCRYPTION_KEY;
  process.env.SHOP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  resetWorkerOfflineAdminCaches();

  const calls = [];
  const storage = createWorkerShopSessionStorage({
    shop: {
      async upsert(args) {
        calls.push({ type: "shop.upsert", args });
        return args;
      },
    },
  }, {
    onlineStorage: {
      async storeSession() {
        calls.push({ type: "online.storeSession" });
        return true;
      },
      async deleteSession(id) {
        calls.push({ type: "online.deleteSession", id });
        return true;
      },
      isReady() {
        return true;
      },
    },
  });

  const session = new Session({
    id: "offline_example.myshopify.com",
    isOnline: false,
    shop: "example.myshopify.com",
    state: "state",
    accessToken: "shpat_test_token",
    scope: "read_products",
  });

  await storage.storeSession(session);

  if (originalKey === undefined) {
    delete process.env.SHOP_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.SHOP_TOKEN_ENCRYPTION_KEY = originalKey;
  }
  resetWorkerOfflineAdminCaches();

  assert.deepEqual(
    calls.map((call) => call.type),
    ["shop.upsert", "online.deleteSession"],
  );
  assert.equal(calls[0].args.create.shopDomain, "example.myshopify.com");
  assert.equal(calls[0].args.create.offlineSessionId, "offline_example.myshopify.com");
});

test("worker shop session storage clears only encrypted offline fields when deleting an offline session", async () => {
  const calls = [];
  const storage = createWorkerShopSessionStorage({
    shop: {
      async updateMany(args) {
        calls.push({ type: "shop.updateMany", args });
        return { count: 1 };
      },
    },
  }, {
    onlineStorage: {
      async deleteSession(id) {
        calls.push({ type: "online.deleteSession", id });
        return true;
      },
      isReady() {
        return true;
      },
    },
  });

  await storage.deleteSession("offline_example.myshopify.com");

  assert.deepEqual(
    calls,
    [
      {
        type: "online.deleteSession",
        id: "offline_example.myshopify.com",
      },
      {
        type: "shop.updateMany",
        args: {
          where: { offlineSessionId: "offline_example.myshopify.com" },
          data: {
            encryptedOfflineSession: Prisma.JsonNull,
            offlineSessionId: null,
          },
        },
      },
    ],
  );
});

test("product export route delegates to shared service boundary", () => {
  const routeFile = readProjectFile("app/routes/app.product-exports.ts");
  const serviceFile = readProjectFile("app/services/product-exports.server.ts");
  const domainFile = readProjectFile("domain/products/export-jobs.mjs");

  assert.match(routeFile, /import \{ createProductExport \} from "~\/app\/services\/product-exports\.server"/);
  assert.doesNotMatch(routeFile, /~\/domain\//);
  assert.match(serviceFile, /enqueueOrFindActiveProductExportJob/);
  assert.match(domainFile, /return findActiveProductExportJob\(\{/);
});

test("product export plan and ADR capture profile artifact and offline-session truth", () => {
  const plan = readProjectFile("plans/PD-001-product-export-foundation.md");
  const adr = readProjectFile("adr/0008-product-export-route-and-artifact-contract.md");

  assert.match(plan, /product-core-seo-v1/);
  assert.match(plan, /manifest は新テーブルでなく private artifact/);
  assert.match(plan, /offline session 不在は retry loop にせず terminal failure/);
  assert.match(plan, /temp file へ page-at-a-time で書き出し/);

  assert.match(adr, /product\.export\.manifest/);
  assert.match(adr, /duplicate enqueue 後に既存 active job を lookup/);
  assert.match(adr, /maxAttempts: 1/);
  assert.match(adr, /cursor page ごとに lease を確認/);
});

test("product export row mapping normalizes tags into a single CSV cell", () => {
  assert.deepEqual(
    mapProductNodeToExportRow({
      descriptionHtml: "<p>Body</p>",
      handle: "sample-product",
      id: "gid://shopify/Product/1",
      productType: "Hat",
      seo: { description: "SEO description", title: "SEO title" },
      status: "ACTIVE",
      tags: ["summer", "sale"],
      title: "Sample Product",
      updatedAt: "2026-03-13T00:00:00Z",
      vendor: "Matri",
    }),
    {
      body_html: "<p>Body</p>",
      handle: "sample-product",
      product_id: "gid://shopify/Product/1",
      product_type: "Hat",
      seo_description: "SEO description",
      seo_title: "SEO title",
      status: "ACTIVE",
      tags: "summer, sale",
      title: "Sample Product",
      updated_at: "2026-03-13T00:00:00Z",
      vendor: "Matri",
    },
  );
});
