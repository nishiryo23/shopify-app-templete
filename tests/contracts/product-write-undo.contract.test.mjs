import test from "node:test";
import assert from "node:assert/strict";

import {
  importMissingOfflineSessionError,
  importProductUndoWorker,
} from "./product-write-test-helpers.mjs";

test("product undo worker stores conflict result without rollback mutation", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  const puts = [];
  let updateCalls = 0;

  const result = await runProductUndoJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get(key) {
        if (String(key).includes("write-result")) {
          return {
            body: Buffer.from(JSON.stringify({
              rows: [{
                changedFields: ["vendor"],
                finalRow: {
                  body_html: "",
                  handle: "hat",
                  product_id: "gid://shopify/Product/1",
                  product_type: "Hat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Hat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor B",
                },
                mutationStatus: "success",
                productId: "gid://shopify/Product/1",
              }],
            })),
          };
        }

        return {
          body: Buffer.from(JSON.stringify({
            rows: [{
              changedFields: ["vendor"],
              preWriteRow: {
                body_html: "",
                handle: "hat",
                product_id: "gid://shopify/Product/1",
                product_type: "Hat",
                seo_description: "",
                seo_title: "",
                status: "ACTIVE",
                tags: "",
                title: "Hat",
                updated_at: "2026-03-14T00:00:00Z",
                vendor: "Vendor A",
              },
              productId: "gid://shopify/Product/1",
            }],
          })),
        };
      },
      async put(args) {
        puts.push(args);
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "undo-job-1",
      payload: {
        profile: "product-core-seo-v1",
        snapshotArtifactId: "snapshot-artifact-1",
        writeArtifactId: "write-artifact-1",
        writeJobId: "write-job-1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst(args) {
          return args.where.kind === "product.write.result"
            ? {
              id: "write-artifact-1",
              kind: "product.write.result",
              objectKey: "write-result.json",
              shopDomain: "example.myshopify.com",
            }
            : {
              id: "snapshot-artifact-1",
              kind: "product.write.snapshot",
              objectKey: "snapshot.json",
              shopDomain: "example.myshopify.com",
            };
        },
      },
    },
    readLiveProducts: async () => new Map([
      ["gid://shopify/Product/1", {
        body_html: "",
        handle: "hat",
        product_id: "gid://shopify/Product/1",
        product_type: "Hat",
        seo_description: "",
        seo_title: "",
        status: "ACTIVE",
        tags: "",
        title: "Hat",
        updated_at: "2026-03-14T00:00:00Z",
        vendor: "Vendor C",
      }],
    ]),
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async () => {
      updateCalls += 1;
      return { userErrors: [] };
    },
  });

  assert.equal(result.outcome, "conflict");
  assert.equal(updateCalls, 0);
  assert.equal(puts.length, 1);
  assert.match(String(puts[0].key), /undo-result\.json$/);
});

test("product undo worker preserves missing-offline-session code when deps are injected", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  const { MissingOfflineSessionError } = await importMissingOfflineSessionError();
  const puts = [];

  await assert.rejects(
    runProductUndoJob({
      artifactCatalog: {
        async record(args) {
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          return {
            body: Buffer.from(JSON.stringify({
              rows: [],
            })),
          };
        },
        async put(args) {
          puts.push(args);
          return {
            bucket: "bucket",
            checksumSha256: "checksum",
            contentType: args.contentType,
            metadata: args.metadata,
            objectKey: args.key,
          };
        },
      },
      job: {
        id: "undo-job-missing-session",
        payload: {
          profile: "product-core-seo-v1",
          snapshotArtifactId: "snapshot-artifact-1",
          writeArtifactId: "write-artifact-1",
          writeJobId: "write-job-1",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst(args) {
            return args.where.kind === "product.write.result"
              ? {
                id: "write-artifact-1",
                kind: "product.write.result",
                objectKey: "write-result.json",
                shopDomain: "example.myshopify.com",
              }
              : {
                id: "snapshot-artifact-1",
                kind: "product.write.snapshot",
                objectKey: "snapshot.json",
                shopDomain: "example.myshopify.com",
              };
          },
        },
      },
      readLiveProducts: async () => new Map(),
      resolveAdminContext: async () => {
        throw new MissingOfflineSessionError("example.myshopify.com");
      },
      updateProduct: async () => ({ userErrors: [] }),
    }),
    (error) => error?.code === "missing-offline-session",
  );

  assert.equal(puts.length, 1);
  assert.match(String(puts[0].key), /undo-error\.json$/);
  assert.equal(JSON.parse(String(puts[0].body)).code, "missing-offline-session");
  assert.equal(puts[0].metadata.code, "missing-offline-session");
});

test("product undo worker emits technical error artifact when snapshot and result rows cannot be joined", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  const puts = [];

  await assert.rejects(
    runProductUndoJob({
      artifactCatalog: {
        async record(args) {
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get(key) {
          if (String(key).includes("write-result")) {
            return {
              body: Buffer.from(JSON.stringify({
                rows: [{
                  changedFields: ["vendor"],
                  finalRow: { product_id: "gid://shopify/Product/2", vendor: "Vendor B" },
                  productId: "gid://shopify/Product/2",
                }],
              })),
            };
          }
          return {
            body: Buffer.from(JSON.stringify({
              rows: [{
                changedFields: ["vendor"],
                preWriteRow: { product_id: "gid://shopify/Product/1", vendor: "Vendor A" },
                productId: "gid://shopify/Product/1",
              }],
            })),
          };
        },
        async put(args) {
          puts.push(args);
          return {
            bucket: "bucket",
            checksumSha256: "checksum",
            contentType: args.contentType,
            metadata: args.metadata,
            objectKey: args.key,
          };
        },
      },
      job: {
        id: "undo-job-join-mismatch",
        payload: {
          profile: "product-core-seo-v1",
          snapshotArtifactId: "snapshot-artifact-join-mismatch",
          writeArtifactId: "write-artifact-join-mismatch",
          writeJobId: "write-job-join-mismatch",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst(args) {
            return args.where.kind === "product.write.result"
              ? {
                id: "write-artifact-join-mismatch",
                kind: "product.write.result",
                objectKey: "write-result-join-mismatch.json",
                shopDomain: "example.myshopify.com",
              }
              : {
                id: "snapshot-artifact-join-mismatch",
                kind: "product.write.snapshot",
                objectKey: "snapshot-join-mismatch.json",
                shopDomain: "example.myshopify.com",
              };
          },
        },
      },
      readLiveProducts: async () => new Map(),
      readLiveRedirects: async () => new Map(),
      resolveAdminContext: async () => ({ admin: {} }),
      updateProduct: async () => ({ userErrors: [] }),
    }),
    /missing-write-result-row|missing-write-snapshot-row/,
  );

  assert.equal(puts.length, 1);
  assert.match(String(puts[0].key), /undo-error\.json$/);
  assert.equal(puts[0].metadata.profile, "product-core-seo-v1");
});

test("product undo worker excludes non-rollbackable handle rows from conflict checks", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  const puts = [];
  let productReadCount = 0;
  let updateCalls = 0;

  const result = await runProductUndoJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get(key) {
        if (String(key).includes("write-result")) {
          return {
            body: Buffer.from(JSON.stringify({
              rows: [
                {
                  changedFields: ["handle"],
                  finalRow: {
                    body_html: "",
                    handle: "hat-new",
                    product_id: "gid://shopify/Product/1",
                    product_type: "Hat",
                    seo_description: "",
                    seo_title: "",
                    status: "ACTIVE",
                    tags: "",
                    title: "Hat",
                    updated_at: "2026-03-14T00:00:00Z",
                    vendor: "Vendor A",
                  },
                  mutationStatus: "success",
                  productId: "gid://shopify/Product/1",
                  rollbackableHandleChange: false,
                },
                {
                  changedFields: ["vendor"],
                  finalRow: {
                    body_html: "",
                    handle: "coat",
                    product_id: "gid://shopify/Product/2",
                    product_type: "Coat",
                    seo_description: "",
                    seo_title: "",
                    status: "ACTIVE",
                    tags: "",
                    title: "Coat",
                    updated_at: "2026-03-14T00:00:00Z",
                    vendor: "Vendor B",
                  },
                  mutationStatus: "success",
                  productId: "gid://shopify/Product/2",
                },
              ],
            })),
          };
        }

        return {
          body: Buffer.from(JSON.stringify({
            rows: [
              {
                changedFields: ["handle"],
                preWriteRow: {
                  body_html: "",
                  handle: "hat-old",
                  product_id: "gid://shopify/Product/1",
                  product_type: "Hat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Hat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor A",
                },
                productId: "gid://shopify/Product/1",
              },
              {
                changedFields: ["vendor"],
                preWriteRow: {
                  body_html: "",
                  handle: "coat",
                  product_id: "gid://shopify/Product/2",
                  product_type: "Coat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Coat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor A",
                },
                productId: "gid://shopify/Product/2",
              },
            ],
          })),
        };
      },
      async put(args) {
        puts.push(args);
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "undo-job-target-filter",
      payload: {
        profile: "product-core-seo-v1",
        snapshotArtifactId: "snapshot-artifact-target-filter",
        writeArtifactId: "write-artifact-target-filter",
        writeJobId: "write-job-target-filter",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst(args) {
          return args.where.kind === "product.write.result"
            ? {
              id: "write-artifact-target-filter",
              kind: "product.write.result",
              objectKey: "write-result-target-filter.json",
              shopDomain: "example.myshopify.com",
            }
            : {
              id: "snapshot-artifact-target-filter",
              kind: "product.write.snapshot",
              objectKey: "snapshot-target-filter.json",
              shopDomain: "example.myshopify.com",
            };
        },
      },
    },
    readLiveProducts: async () => {
      productReadCount += 1;
      return new Map([
      ["gid://shopify/Product/1", {
        body_html: "",
        handle: "hat-drifted",
        product_id: "gid://shopify/Product/1",
        product_type: "Hat",
        seo_description: "",
        seo_title: "",
        status: "ACTIVE",
        tags: "",
        title: "Hat",
        updated_at: "2026-03-14T00:00:00Z",
        vendor: "Vendor A",
      }],
      ["gid://shopify/Product/2", {
        body_html: "",
        handle: "coat",
        product_id: "gid://shopify/Product/2",
        product_type: "Coat",
        seo_description: "",
        seo_title: "",
        status: "ACTIVE",
        tags: "",
        title: "Coat",
        updated_at: "2026-03-14T00:00:00Z",
        vendor: productReadCount === 1 ? "Vendor B" : "Vendor A",
      }],
      ]);
    },
    readLiveRedirects: async () => new Map(),
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async () => {
      updateCalls += 1;
      return { userErrors: [] };
    },
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.summary.total, 1);
  assert.equal(updateCalls, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].productId, "gid://shopify/Product/2");
  assert.equal(puts.length, 1);
  assert.match(String(puts[0].key), /undo-result\.json$/);
});

test("product undo worker excludes non-applied rows from rollback targets", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  const puts = [];
  let productReadCount = 0;
  let updateCalls = 0;

  const result = await runProductUndoJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get(key) {
        if (String(key).includes("write-result")) {
          return {
            body: Buffer.from(JSON.stringify({
              rows: [
                {
                  changedFields: ["vendor"],
                  finalRow: {
                    body_html: "",
                    handle: "hat",
                    product_id: "gid://shopify/Product/1",
                    product_type: "Hat",
                    seo_description: "",
                    seo_title: "",
                    status: "ACTIVE",
                    tags: "",
                    title: "Hat",
                    updated_at: "2026-03-14T00:00:00Z",
                    vendor: "Vendor B",
                  },
                  mutationStatus: "success",
                  productId: "gid://shopify/Product/1",
                },
                {
                  changedFields: ["vendor"],
                  finalRow: {
                    body_html: "",
                    handle: "coat",
                    product_id: "gid://shopify/Product/2",
                    product_type: "Coat",
                    seo_description: "",
                    seo_title: "",
                    status: "ACTIVE",
                    tags: "",
                    title: "Coat",
                    updated_at: "2026-03-14T00:00:00Z",
                    vendor: "Vendor B",
                  },
                  mutationStatus: "failed",
                  productId: "gid://shopify/Product/2",
                },
              ],
            })),
          };
        }

        return {
          body: Buffer.from(JSON.stringify({
            rows: [
              {
                changedFields: ["vendor"],
                preWriteRow: {
                  body_html: "",
                  handle: "hat",
                  product_id: "gid://shopify/Product/1",
                  product_type: "Hat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Hat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor A",
                },
                productId: "gid://shopify/Product/1",
              },
              {
                changedFields: ["vendor"],
                preWriteRow: {
                  body_html: "",
                  handle: "coat",
                  product_id: "gid://shopify/Product/2",
                  product_type: "Coat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Coat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor A",
                },
                productId: "gid://shopify/Product/2",
              },
            ],
          })),
        };
      },
      async put(args) {
        puts.push(args);
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "undo-job-applied-target-filter",
      payload: {
        profile: "product-core-seo-v1",
        snapshotArtifactId: "snapshot-artifact-applied-target-filter",
        writeArtifactId: "write-artifact-applied-target-filter",
        writeJobId: "write-job-applied-target-filter",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst(args) {
          return args.where.kind === "product.write.result"
            ? {
              id: "write-artifact-applied-target-filter",
              kind: "product.write.result",
              objectKey: "write-result-applied-target-filter.json",
              shopDomain: "example.myshopify.com",
            }
            : {
              id: "snapshot-artifact-applied-target-filter",
              kind: "product.write.snapshot",
              objectKey: "snapshot-applied-target-filter.json",
              shopDomain: "example.myshopify.com",
            };
        },
      },
    },
    readLiveProducts: async () => {
      productReadCount += 1;
      return new Map([
        ["gid://shopify/Product/1", {
          body_html: "",
          handle: "hat",
          product_id: "gid://shopify/Product/1",
          product_type: "Hat",
          seo_description: "",
          seo_title: "",
          status: "ACTIVE",
          tags: "",
          title: "Hat",
          updated_at: "2026-03-14T00:00:00Z",
          vendor: productReadCount === 1 ? "Vendor B" : "Vendor A",
        }],
      ]);
    },
    readLiveRedirects: async () => new Map(),
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async () => {
      updateCalls += 1;
      return { userErrors: [] };
    },
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.summary.total, 1);
  assert.equal(updateCalls, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].productId, "gid://shopify/Product/1");
  assert.equal(puts.length, 1);
  assert.match(String(puts[0].key), /undo-result\.json$/);
});

test("product undo worker treats missing redirect id as already cleaned and restores the previous handle", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  let productReadCount = 0;
  let updateInput = null;

  const result = await runProductUndoJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get(key) {
        if (String(key).includes("write-result")) {
          return {
            body: Buffer.from(JSON.stringify({
              rows: [{
                changedFields: ["handle"],
                finalRow: {
                  body_html: "",
                  handle: "hat-new",
                  product_id: "gid://shopify/Product/1",
                  product_type: "Hat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Hat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor A",
                },
                mutationStatus: "success",
                nextHandle: "hat-new",
                previousHandle: "hat-old",
                productId: "gid://shopify/Product/1",
                redirectCleanupMode: "delete-by-id",
                redirectId: "gid://shopify/UrlRedirect/1",
                redirectPath: "/products/hat-old",
                redirectTarget: "/products/hat-new",
                rollbackableHandleChange: true,
              }],
            })),
          };
        }

        return {
          body: Buffer.from(JSON.stringify({
            rows: [{
              changedFields: ["handle"],
              preWriteRow: {
                body_html: "",
                handle: "hat-old",
                product_id: "gid://shopify/Product/1",
                product_type: "Hat",
                seo_description: "",
                seo_title: "",
                status: "ACTIVE",
                tags: "",
                title: "Hat",
                updated_at: "2026-03-14T00:00:00Z",
                vendor: "Vendor A",
              },
              productId: "gid://shopify/Product/1",
            }],
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
          body: args.body,
        };
      },
    },
    deleteRedirect: async () => ({
      deletedUrlRedirectId: null,
      notFound: true,
      userErrors: [{ field: ["id"], message: "Redirect not found" }],
    }),
    job: {
      id: "undo-job-redirect-not-found",
      payload: {
        profile: "product-core-seo-v1",
        snapshotArtifactId: "snapshot-artifact-redirect-not-found",
        writeArtifactId: "write-artifact-redirect-not-found",
        writeJobId: "write-job-redirect-not-found",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst(args) {
          return args.where.kind === "product.write.result"
            ? {
              id: "write-artifact-redirect-not-found",
              kind: "product.write.result",
              objectKey: "write-result-redirect-not-found.json",
              shopDomain: "example.myshopify.com",
            }
            : {
              id: "snapshot-artifact-redirect-not-found",
              kind: "product.write.snapshot",
              objectKey: "snapshot-redirect-not-found.json",
              shopDomain: "example.myshopify.com",
            };
        },
      },
    },
    readLiveProducts: async () => {
      productReadCount += 1;
      return new Map([["gid://shopify/Product/1", {
        body_html: "",
        handle: productReadCount === 1 ? "hat-new" : "hat-old",
        product_id: "gid://shopify/Product/1",
        product_type: "Hat",
        seo_description: "",
        seo_title: "",
        status: "ACTIVE",
        tags: "",
        title: "Hat",
        updated_at: "2026-03-14T00:00:00Z",
        vendor: "Vendor A",
      }]]);
    },
    readLiveRedirects: async () => new Map([["/products/hat-old", []]]),
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async (_admin, input) => {
      updateInput = input;
      return { userErrors: [] };
    },
  });

  assert.equal(updateInput.handle, "hat-old");
  assert.equal("redirectNewHandle" in updateInput, false);
  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.match(result.rows[0].messages[0], /already removed/i);
});

test("product undo worker rolls back rollbackable handle rows after transport errors", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  let productReadCount = 0;
  let updateInput = null;
  let deleteCalls = 0;

  const result = await runProductUndoJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get(key) {
        if (String(key).includes("write-result")) {
          return {
            body: Buffer.from(JSON.stringify({
              rows: [{
                changedFields: ["handle"],
                finalRow: {
                  body_html: "",
                  handle: "hat-new",
                  product_id: "gid://shopify/Product/1",
                  product_type: "Hat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Hat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor A",
                },
                mutationStatus: "failed",
                nextHandle: "hat-new",
                previousHandle: "hat-old",
                productId: "gid://shopify/Product/1",
                redirectCleanupMode: "delete-by-id",
                redirectId: "gid://shopify/UrlRedirect/1",
                redirectPath: "/products/hat-old",
                redirectTarget: "/products/hat-new",
                rollbackableHandleChange: true,
                verificationStatus: "verified",
              }],
            })),
          };
        }

        return {
          body: Buffer.from(JSON.stringify({
            rows: [{
              changedFields: ["handle"],
              preWriteRow: {
                body_html: "",
                handle: "hat-old",
                product_id: "gid://shopify/Product/1",
                product_type: "Hat",
                seo_description: "",
                seo_title: "",
                status: "ACTIVE",
                tags: "",
                title: "Hat",
                updated_at: "2026-03-14T00:00:00Z",
                vendor: "Vendor A",
              },
              productId: "gid://shopify/Product/1",
            }],
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
          body: args.body,
        };
      },
    },
    deleteRedirect: async () => {
      deleteCalls += 1;
      return {
        deletedUrlRedirectId: "gid://shopify/UrlRedirect/1",
        notFound: false,
        userErrors: [],
      };
    },
    job: {
      id: "undo-job-handle-transport-error",
      payload: {
        profile: "product-core-seo-v1",
        snapshotArtifactId: "snapshot-artifact-handle-transport-error",
        writeArtifactId: "write-artifact-handle-transport-error",
        writeJobId: "write-job-handle-transport-error",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst(args) {
          return args.where.kind === "product.write.result"
            ? {
              id: "write-artifact-handle-transport-error",
              kind: "product.write.result",
              objectKey: "write-result-handle-transport-error.json",
              shopDomain: "example.myshopify.com",
            }
            : {
              id: "snapshot-artifact-handle-transport-error",
              kind: "product.write.snapshot",
              objectKey: "snapshot-handle-transport-error.json",
              shopDomain: "example.myshopify.com",
            };
        },
      },
    },
    readLiveProducts: async () => {
      productReadCount += 1;
      return new Map([["gid://shopify/Product/1", {
        body_html: "",
        handle: productReadCount === 1 ? "hat-new" : "hat-old",
        product_id: "gid://shopify/Product/1",
        product_type: "Hat",
        seo_description: "",
        seo_title: "",
        status: "ACTIVE",
        tags: "",
        title: "Hat",
        updated_at: "2026-03-14T00:00:00Z",
        vendor: "Vendor A",
      }]]);
    },
    readLiveRedirects: async () => new Map([["/products/hat-old", []]]),
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async (_admin, input) => {
      updateInput = input;
      return { userErrors: [] };
    },
  });

  assert.equal(deleteCalls, 1);
  assert.equal(updateInput.handle, "hat-old");
  assert.equal(result.outcome, "verified_success");
  assert.equal(result.summary.total, 1);
  assert.equal(result.rows[0].verificationStatus, "verified");
});

test("product undo worker leaves forward redirects intact when handle restore fails", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  let deleteCalls = 0;
  let readRedirectCalls = 0;

  const result = await runProductUndoJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get(key) {
        if (String(key).includes("write-result")) {
          return {
            body: Buffer.from(JSON.stringify({
              rows: [{
                changedFields: ["handle"],
                finalRow: {
                  body_html: "",
                  handle: "hat-new",
                  product_id: "gid://shopify/Product/1",
                  product_type: "Hat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Hat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor A",
                },
                mutationStatus: "success",
                nextHandle: "hat-new",
                previousHandle: "hat-old",
                productId: "gid://shopify/Product/1",
                redirectCleanupMode: "delete-by-id",
                redirectId: "gid://shopify/UrlRedirect/1",
                redirectPath: "/products/hat-old",
                redirectTarget: "/products/hat-new",
                rollbackableHandleChange: true,
              }],
            })),
          };
        }

        return {
          body: Buffer.from(JSON.stringify({
            rows: [{
              changedFields: ["handle"],
              preWriteRow: {
                body_html: "",
                handle: "hat-old",
                product_id: "gid://shopify/Product/1",
                product_type: "Hat",
                seo_description: "",
                seo_title: "",
                status: "ACTIVE",
                tags: "",
                title: "Hat",
                updated_at: "2026-03-14T00:00:00Z",
                vendor: "Vendor A",
              },
              productId: "gid://shopify/Product/1",
            }],
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
          body: args.body,
        };
      },
    },
    deleteRedirect: async () => {
      deleteCalls += 1;
      return {
        deletedUrlRedirectId: "gid://shopify/UrlRedirect/1",
        notFound: false,
        userErrors: [],
      };
    },
    job: {
      id: "undo-job-handle-restore-failed",
      payload: {
        profile: "product-core-seo-v1",
        snapshotArtifactId: "snapshot-artifact-handle-restore-failed",
        writeArtifactId: "write-artifact-handle-restore-failed",
        writeJobId: "write-job-handle-restore-failed",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst(args) {
          return args.where.kind === "product.write.result"
            ? {
              id: "write-artifact-handle-restore-failed",
              kind: "product.write.result",
              objectKey: "write-result-handle-restore-failed.json",
              shopDomain: "example.myshopify.com",
            }
            : {
              id: "snapshot-artifact-handle-restore-failed",
              kind: "product.write.snapshot",
              objectKey: "snapshot-handle-restore-failed.json",
              shopDomain: "example.myshopify.com",
            };
        },
      },
    },
    readLiveProducts: async () => new Map([["gid://shopify/Product/1", {
      body_html: "",
      handle: "hat-new",
      product_id: "gid://shopify/Product/1",
      product_type: "Hat",
      seo_description: "",
      seo_title: "",
      status: "ACTIVE",
      tags: "",
      title: "Hat",
      updated_at: "2026-03-14T00:00:00Z",
      vendor: "Vendor A",
    }]]),
    readLiveRedirects: async () => {
      readRedirectCalls += 1;
      return new Map([["/products/hat-old", [{
        id: "gid://shopify/UrlRedirect/1",
        path: "/products/hat-old",
        target: "/products/hat-new",
      }]]]);
    },
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async () => ({
      userErrors: [{ field: ["handle"], message: "handle is already reserved" }],
    }),
  });

  assert.equal(deleteCalls, 1);
  assert.equal(readRedirectCalls, 1);
  assert.equal(result.outcome, "verified_failure");
  assert.equal(result.rows[0].rollbackStatus, "failed");
  assert.match(result.rows[0].messages.join(" "), /reserved/i);
});

test("product undo worker does not restore the old handle when redirect cleanup fails", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  let updateCalls = 0;

  const result = await runProductUndoJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get(key) {
        if (String(key).includes("write-result")) {
          return {
            body: Buffer.from(JSON.stringify({
              rows: [{
                changedFields: ["handle"],
                finalRow: {
                  body_html: "",
                  handle: "hat-new",
                  product_id: "gid://shopify/Product/1",
                  product_type: "Hat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Hat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor A",
                },
                mutationStatus: "success",
                nextHandle: "hat-new",
                previousHandle: "hat-old",
                productId: "gid://shopify/Product/1",
                redirectCleanupMode: "delete-by-id",
                redirectId: "gid://shopify/UrlRedirect/1",
                redirectPath: "/products/hat-old",
                redirectTarget: "/products/hat-new",
                rollbackableHandleChange: true,
              }],
            })),
          };
        }

        return {
          body: Buffer.from(JSON.stringify({
            rows: [{
              changedFields: ["handle"],
              preWriteRow: {
                body_html: "",
                handle: "hat-old",
                product_id: "gid://shopify/Product/1",
                product_type: "Hat",
                seo_description: "",
                seo_title: "",
                status: "ACTIVE",
                tags: "",
                title: "Hat",
                updated_at: "2026-03-14T00:00:00Z",
                vendor: "Vendor A",
              },
              productId: "gid://shopify/Product/1",
            }],
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
          body: args.body,
        };
      },
    },
    deleteRedirect: async () => ({
      deletedUrlRedirectId: null,
      notFound: false,
      userErrors: [{ field: ["id"], message: "Redirect is locked" }],
    }),
    job: {
      id: "undo-job-cleanup-failed",
      payload: {
        profile: "product-core-seo-v1",
        snapshotArtifactId: "snapshot-artifact-cleanup-failed",
        writeArtifactId: "write-artifact-cleanup-failed",
        writeJobId: "write-job-cleanup-failed",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst(args) {
          return args.where.kind === "product.write.result"
            ? {
              id: "write-artifact-cleanup-failed",
              kind: "product.write.result",
              objectKey: "write-result-cleanup-failed.json",
              shopDomain: "example.myshopify.com",
            }
            : {
              id: "snapshot-artifact-cleanup-failed",
              kind: "product.write.snapshot",
              objectKey: "snapshot-cleanup-failed.json",
              shopDomain: "example.myshopify.com",
            };
        },
      },
    },
    readLiveProducts: async () => new Map([["gid://shopify/Product/1", {
      body_html: "",
      handle: "hat-new",
      product_id: "gid://shopify/Product/1",
      product_type: "Hat",
      seo_description: "",
      seo_title: "",
      status: "ACTIVE",
      tags: "",
      title: "Hat",
      updated_at: "2026-03-14T00:00:00Z",
      vendor: "Vendor A",
    }]]),
    readLiveRedirects: async () => new Map([["/products/hat-old", [{
      id: "gid://shopify/UrlRedirect/1",
      path: "/products/hat-old",
      target: "/products/hat-new",
    }]]]),
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async () => {
      updateCalls += 1;
      return { userErrors: [] };
    },
  });

  assert.equal(updateCalls, 0);
  assert.equal(result.outcome, "verified_failure");
  assert.equal(result.rows[0].rollbackStatus, "failed");
  assert.match(result.rows[0].messages.join(" "), /locked/i);
});

test("product undo worker fails when a replacement same-path redirect still exists", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  let productReadCount = 0;

  const result = await runProductUndoJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get(key) {
        if (String(key).includes("write-result")) {
          return {
            body: Buffer.from(JSON.stringify({
              rows: [{
                changedFields: ["handle"],
                finalRow: {
                  body_html: "",
                  handle: "hat-new",
                  product_id: "gid://shopify/Product/1",
                  product_type: "Hat",
                  seo_description: "",
                  seo_title: "",
                  status: "ACTIVE",
                  tags: "",
                  title: "Hat",
                  updated_at: "2026-03-14T00:00:00Z",
                  vendor: "Vendor A",
                },
                mutationStatus: "success",
                nextHandle: "hat-new",
                previousHandle: "hat-old",
                productId: "gid://shopify/Product/1",
                redirectCleanupMode: "delete-by-id",
                redirectId: "gid://shopify/UrlRedirect/1",
                redirectPath: "/products/hat-old",
                redirectTarget: "/products/hat-new",
                rollbackableHandleChange: true,
              }],
            })),
          };
        }

        return {
          body: Buffer.from(JSON.stringify({
            rows: [{
              changedFields: ["handle"],
              preWriteRow: {
                body_html: "",
                handle: "hat-old",
                product_id: "gid://shopify/Product/1",
                product_type: "Hat",
                seo_description: "",
                seo_title: "",
                status: "ACTIVE",
                tags: "",
                title: "Hat",
                updated_at: "2026-03-14T00:00:00Z",
                vendor: "Vendor A",
              },
              productId: "gid://shopify/Product/1",
            }],
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
          body: args.body,
        };
      },
    },
    deleteRedirect: async () => ({
      deletedUrlRedirectId: null,
      notFound: true,
      userErrors: [{ field: ["id"], message: "Redirect not found" }],
    }),
    job: {
      id: "undo-job-replacement-redirect",
      payload: {
        profile: "product-core-seo-v1",
        snapshotArtifactId: "snapshot-artifact-replacement-redirect",
        writeArtifactId: "write-artifact-replacement-redirect",
        writeJobId: "write-job-replacement-redirect",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst(args) {
          return args.where.kind === "product.write.result"
            ? {
              id: "write-artifact-replacement-redirect",
              kind: "product.write.result",
              objectKey: "write-result-replacement-redirect.json",
              shopDomain: "example.myshopify.com",
            }
            : {
              id: "snapshot-artifact-replacement-redirect",
              kind: "product.write.snapshot",
              objectKey: "snapshot-replacement-redirect.json",
              shopDomain: "example.myshopify.com",
            };
        },
      },
    },
    readLiveProducts: async () => {
      productReadCount += 1;
      return new Map([["gid://shopify/Product/1", {
        body_html: "",
        handle: productReadCount === 1 ? "hat-new" : "hat-old",
        product_id: "gid://shopify/Product/1",
        product_type: "Hat",
        seo_description: "",
        seo_title: "",
        status: "ACTIVE",
        tags: "",
        title: "Hat",
        updated_at: "2026-03-14T00:00:00Z",
        vendor: "Vendor A",
      }]]);
    },
    readLiveRedirects: async () => new Map([["/products/hat-old", [{
      id: "gid://shopify/UrlRedirect/2",
      path: "/products/hat-old",
      target: "/collections/hats",
    }]]]),
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async () => ({ userErrors: [] }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.equal(result.rows[0].verificationStatus, "failed");
  assert.match(result.rows[0].messages.join(" "), /live redirect still exists/i);
});

test("product undo worker rejects expired rollback artifacts at execution time", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  const puts = [];
  let storageReads = 0;
  let updateCalls = 0;

  await assert.rejects(
    runProductUndoJob({
      artifactCatalog: {
        async record(args) {
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          storageReads += 1;
          return {
            body: Buffer.from(JSON.stringify({ rows: [] })),
          };
        },
        async put(args) {
          puts.push(args);
          return {
            bucket: "bucket",
            checksumSha256: "checksum",
            contentType: args.contentType,
            metadata: args.metadata,
            objectKey: args.key,
          };
        },
      },
      job: {
        id: "undo-job-retention-expired",
        payload: {
          profile: "product-core-seo-v1",
          snapshotArtifactId: "snapshot-artifact-retention-expired",
          writeArtifactId: "write-artifact-retention-expired",
          writeJobId: "write-job-retention-expired",
        },
        shopDomain: "example.myshopify.com",
      },
      now: new Date("2026-06-16T00:00:00.000Z"),
      prisma: {
        artifact: {
          async findFirst(args) {
            return args.where.kind === "product.write.result"
              ? {
                deletedAt: null,
                id: "write-artifact-retention-expired",
                kind: "product.write.result",
                objectKey: "write-result-retention-expired.json",
                retentionUntil: new Date("2026-06-15T00:00:00.000Z"),
                shopDomain: "example.myshopify.com",
              }
              : {
                deletedAt: null,
                id: "snapshot-artifact-retention-expired",
                kind: "product.write.snapshot",
                objectKey: "snapshot-retention-expired.json",
                retentionUntil: new Date("2026-06-15T00:00:00.000Z"),
                shopDomain: "example.myshopify.com",
              };
          },
        },
      },
      readLiveProducts: async () => new Map(),
      readLiveRedirects: async () => new Map(),
      resolveAdminContext: async () => ({ admin: {} }),
      updateProduct: async () => {
        updateCalls += 1;
        return { userErrors: [] };
      },
    }),
    (error) => error?.code === "retention-expired",
  );

  assert.equal(storageReads, 0);
  assert.equal(updateCalls, 0);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].metadata.code, "retention-expired");
});

test("product undo worker treats soft-deleted rollback artifacts as retention-expired before reading storage", async () => {
  const { runProductUndoJob } = await importProductUndoWorker();
  const puts = [];
  let storageReads = 0;
  let updateCalls = 0;

  await assert.rejects(
    runProductUndoJob({
      artifactCatalog: {
        async record(args) {
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          storageReads += 1;
          return {
            body: Buffer.from(JSON.stringify({ rows: [] })),
          };
        },
        async put(args) {
          puts.push(args);
          return {
            bucket: "bucket",
            checksumSha256: "checksum",
            contentType: args.contentType,
            metadata: args.metadata,
            objectKey: args.key,
          };
        },
      },
      job: {
        id: "undo-job-soft-deleted-retention",
        payload: {
          profile: "product-core-seo-v1",
          snapshotArtifactId: "snapshot-artifact-soft-deleted-retention",
          writeArtifactId: "write-artifact-soft-deleted-retention",
          writeJobId: "write-job-soft-deleted-retention",
        },
        shopDomain: "example.myshopify.com",
      },
      now: new Date("2026-06-16T00:00:00.000Z"),
      prisma: {
        artifact: {
          async findFirst(args) {
            return args.where.kind === "product.write.result"
              ? {
                deletedAt: new Date("2026-06-16T00:00:00.000Z"),
                id: "write-artifact-soft-deleted-retention",
                kind: "product.write.result",
                objectKey: "write-result-soft-deleted-retention.json",
                retentionUntil: new Date("2026-06-15T00:00:00.000Z"),
                shopDomain: "example.myshopify.com",
              }
              : {
                deletedAt: null,
                id: "snapshot-artifact-soft-deleted-retention",
                kind: "product.write.snapshot",
                objectKey: "snapshot-soft-deleted-retention.json",
                retentionUntil: new Date("2026-06-15T00:00:00.000Z"),
                shopDomain: "example.myshopify.com",
              };
          },
        },
      },
      readLiveProducts: async () => new Map(),
      readLiveRedirects: async () => new Map(),
      resolveAdminContext: async () => ({ admin: {} }),
      updateProduct: async () => {
        updateCalls += 1;
        return { userErrors: [] };
      },
    }),
    (error) => error?.code === "retention-expired",
  );

  assert.equal(storageReads, 0);
  assert.equal(updateCalls, 0);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].metadata.code, "retention-expired");
});
