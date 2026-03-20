import test from "node:test";
import assert from "node:assert/strict";

import {
  importProductWriteWorker,
  readProjectFile,
} from "./product-write-test-helpers.mjs";

test("product write worker persists rollbackable result before rethrowing infrastructure failure", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const puts = [];
  let readCount = 0;
  await assert.rejects(
    runProductWriteJob({
      artifactCatalog: {
        async record(args) {
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          return {
            body: Buffer.from(JSON.stringify({
              previewDigest: "preview-digest",
              profile: "product-core-seo-v1",
              rows: [
                {
                  changedFields: ["vendor"],
                  currentRow: {
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
                  editedRow: {
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
                  productId: "gid://shopify/Product/1",
                },
                {
                  changedFields: ["title"],
                  currentRow: {
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
                  editedRow: {
                    body_html: "",
                    handle: "coat",
                    product_id: "gid://shopify/Product/2",
                    product_type: "Coat",
                    seo_description: "",
                    seo_title: "",
                    status: "ACTIVE",
                    tags: "",
                    title: "Coat Updated",
                    updated_at: "2026-03-14T00:00:00Z",
                    vendor: "Vendor A",
                  },
                  productId: "gid://shopify/Product/2",
                },
              ],
              summary: { error: 0, total: 2 },
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
        id: "write-job-throw",
        payload: {
          previewArtifactId: "preview-artifact-1",
          previewDigest: "preview-digest",
          previewJobId: "preview-job-1",
          profile: "product-core-seo-v1",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst() {
            return {
              id: "preview-artifact-1",
              kind: "product.preview.result",
              objectKey: "preview/result.json",
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
      readLiveProducts: async (_admin, productIds) => {
        readCount += 1;
        return new Map(
          productIds.map((productId) => [productId, productId === "gid://shopify/Product/1"
            ? {
              body_html: "",
              handle: "hat",
              product_id: productId,
              product_type: "Hat",
              seo_description: "",
              seo_title: "",
              status: "ACTIVE",
              tags: "",
              title: "Hat",
              updated_at: "2026-03-14T00:00:00Z",
              vendor: readCount === 1 ? "Vendor A" : "Vendor B",
            }
            : {
              body_html: "",
              handle: "coat",
              product_id: productId,
              product_type: "Coat",
              seo_description: "",
              seo_title: "",
              status: "ACTIVE",
              tags: "",
              title: "Coat",
              updated_at: "2026-03-14T00:00:00Z",
              vendor: "Vendor A",
            }]),
        );
      },
      resolveAdminContext: async () => ({ admin: {} }),
      updateProduct: async (_admin, input) => {
        if (input.id === "gid://shopify/Product/2") {
          throw new Error("shopify network failure");
        }
        return { userErrors: [] };
      },
    }),
    /shopify network failure/,
  );

  assert.equal(puts.length, 3);
  assert.match(String(puts[0].key), /snapshot\.json$/);
  assert.match(String(puts[1].key), /result\.json$/);
  assert.equal(JSON.parse(String(puts[1].body)).outcome, "partial_failure");
  assert.match(String(puts[2].key), /error\.json$/);
});

test("product write worker stores revalidation_failed result without snapshot or mutation", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const puts = [];
  let updateCalls = 0;
  const result = await runProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            profile: "product-core-seo-v1",
            rows: [{
              changedFields: ["vendor"],
              currentRow: {
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
              editedRow: {
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
              productId: "gid://shopify/Product/1",
            }],
            summary: { error: 0, total: 1 },
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
      id: "write-job-1",
      payload: {
        previewArtifactId: "preview-artifact-1",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-1",
        profile: "product-core-seo-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-1",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
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
        title: "Hat changed",
        updated_at: "2026-03-14T00:00:00Z",
        vendor: "Vendor A",
      }],
    ]),
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async () => {
      updateCalls += 1;
      return { userErrors: [] };
    },
  });

  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(updateCalls, 0);
  assert.equal(puts.length, 1);
  assert.match(String(puts[0].key), /result\.json$/);
});

test("product preview rows expose handle redirect metadata and reject existing live redirects", async () => {
  const { buildPreviewRows } = await import("../../domain/products/preview-csv.mjs");

  const preview = buildPreviewRows({
    baselineRowsByProductId: new Map([["gid://shopify/Product/1", {
      row: {
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
      rowNumber: 2,
    }]]),
    currentRedirectsByPath: new Map([["/products/hat-old", [{
      id: "gid://shopify/UrlRedirect/1",
      path: "/products/hat-old",
      target: "/products/hat-new",
    }]]]),
    currentRowsByProductId: new Map([["gid://shopify/Product/1", {
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
    }]]),
    editedRows: [{
      row: {
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
      rowNumber: 2,
    }],
  });

  assert.equal(preview.summary.error, 1);
  assert.equal(preview.rows[0].classification, "error");
  assert.equal(preview.rows[0].previousHandle, "hat-old");
  assert.equal(preview.rows[0].nextHandle, "hat-new");
  assert.equal(preview.rows[0].redirectPath, "/products/hat-old");
  assert.equal(preview.rows[0].redirectTarget, "/products/hat-new");
  assert.match(preview.rows[0].messages[0], /live redirect already exists/i);
});

test("product preview rows normalize handle redirect metadata without inventing a slug", async () => {
  const { buildPreviewRows } = await import("../../domain/products/preview-csv.mjs");

  const preview = buildPreviewRows({
    baselineRowsByProductId: new Map([["gid://shopify/Product/1", {
      row: {
        body_html: "",
        handle: "Hat-Old",
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
      rowNumber: 2,
    }]]),
    currentRedirectsByPath: new Map(),
    currentRowsByProductId: new Map([["gid://shopify/Product/1", {
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
    }]]),
    editedRows: [{
      row: {
        body_html: "",
        handle: "HAT-NEW",
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
      rowNumber: 2,
    }],
  });

  assert.equal(preview.rows[0].previousHandle, "hat-old");
  assert.equal(preview.rows[0].nextHandle, "hat-new");
  assert.equal(preview.rows[0].redirectPath, "/products/hat-old");
  assert.equal(preview.rows[0].redirectTarget, "/products/hat-new");
});

test("product preview rejects invalid handle edits instead of canonicalizing them", async () => {
  const { buildPreviewRows } = await import("../../domain/products/preview-csv.mjs");

  const preview = buildPreviewRows({
    baselineRowsByProductId: new Map([["gid://shopify/Product/1", {
      row: {
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
      rowNumber: 2,
    }]]),
    currentRedirectsByPath: new Map(),
    currentRowsByProductId: new Map([["gid://shopify/Product/1", {
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
    editedRows: [{
      row: {
        body_html: "",
        handle: " Hat New ",
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
      rowNumber: 2,
    }],
  });

  assert.deepEqual(preview.rows[0].changedFields, ["handle"]);
  assert.equal(preview.rows[0].classification, "error");
  assert.match(preview.rows[0].messages.join(" "), /letters-numbers-hyphens contract/i);
  assert.equal(preview.rows[0].nextHandle, "");
  assert.equal(preview.rows[0].redirectTarget, "");
});

test("product preview treats case-only handle edits as unchanged", async () => {
  const { buildPreviewRows } = await import("../../domain/products/preview-csv.mjs");

  const preview = buildPreviewRows({
    baselineRowsByProductId: new Map([["gid://shopify/Product/1", {
      row: {
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
      rowNumber: 2,
    }]]),
    currentRedirectsByPath: new Map(),
    currentRowsByProductId: new Map([["gid://shopify/Product/1", {
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
    editedRows: [{
      row: {
        body_html: "",
        handle: "HAT-NEW",
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
      rowNumber: 2,
    }],
  });

  assert.deepEqual(preview.rows[0].changedFields, []);
  assert.equal(preview.rows[0].classification, "unchanged");
  assert.equal(preview.rows[0].previousHandle, null);
  assert.equal(preview.rows[0].nextHandle, null);
  assert.equal(preview.rows[0].redirectPath, null);
  assert.equal(preview.rows[0].redirectTarget, null);
});

test("product preview marks already-applied live handle edits as non-writable warnings", async () => {
  const { buildPreviewRows } = await import("../../domain/products/preview-csv.mjs");

  const preview = buildPreviewRows({
    baselineRowsByProductId: new Map([["gid://shopify/Product/1", {
      row: {
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
      rowNumber: 2,
    }]]),
    currentRedirectsByPath: new Map(),
    currentRowsByProductId: new Map([["gid://shopify/Product/1", {
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
    editedRows: [{
      row: {
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
      rowNumber: 2,
    }],
  });

  assert.deepEqual(preview.rows[0].changedFields, []);
  assert.equal(preview.rows[0].classification, "warning");
  assert.match(preview.rows[0].messages.join(" "), /already matches the edited handle/i);
  assert.equal(preview.rows[0].previousHandle, null);
  assert.equal(preview.rows[0].nextHandle, null);
  assert.equal(preview.rows[0].redirectPath, null);
  assert.equal(preview.rows[0].redirectTarget, null);
});

test("product write worker fails revalidation when a handle redirect appears after preview", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const puts = [];
  let updateCalls = 0;

  const result = await runProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest-handle",
            profile: "product-core-seo-v1",
            rows: [{
              changedFields: ["handle"],
              currentRow: {
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
              editedRow: {
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
              nextHandle: "hat-new",
              previousHandle: "hat-old",
              productId: "gid://shopify/Product/1",
              redirectAction: "create",
              redirectPath: "/products/hat-old",
              redirectTarget: "/products/hat-new",
            }],
            summary: { error: 0, total: 1 },
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
      id: "write-job-handle-revalidation",
      payload: {
        previewArtifactId: "preview-artifact-handle-revalidation",
        previewDigest: "preview-digest-handle",
        previewJobId: "preview-job-handle-revalidation",
        profile: "product-core-seo-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-handle-revalidation",
            kind: "product.preview.result",
            objectKey: "preview/result-handle-revalidation.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveProducts: async () => new Map([["gid://shopify/Product/1", {
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

  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(result.rows[0].verificationStatus, "revalidation_failed");
  assert.match(result.rows[0].messages.join(" "), /redirect/i);
  assert.equal(updateCalls, 0);
  assert.equal(puts.length, 1);
});

test("product write worker rehydrates redirect metadata for legacy handle preview rows", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const puts = [];
  let productReadCount = 0;
  let redirectReadCount = 0;

  const result = await runProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return {
          id: args.kind === "product.write.snapshot" ? "snapshot-artifact-legacy-handle" : `${args.kind}-record`,
          ...args,
        };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest-legacy-handle",
            profile: "product-core-seo-v1",
            rows: [{
              changedFields: ["handle"],
              currentRow: {
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
              editedRow: {
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
              productId: "gid://shopify/Product/1",
            }],
            summary: { error: 0, total: 1 },
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
          body: args.body,
        };
      },
    },
    job: {
      id: "write-job-legacy-handle",
      payload: {
        previewArtifactId: "preview-artifact-legacy-handle",
        previewDigest: "preview-digest-legacy-handle",
        previewJobId: "preview-job-legacy-handle",
        profile: "product-core-seo-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-legacy-handle",
            kind: "product.preview.result",
            objectKey: "preview/result-legacy-handle.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveProducts: async () => {
      productReadCount += 1;
      return new Map([["gid://shopify/Product/1", {
      body_html: "",
      handle: productReadCount === 1 ? "hat-old" : "hat-new",
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
    readLiveRedirects: async () => {
      redirectReadCount += 1;
      return new Map([["/products/hat-old", redirectReadCount === 1 ? [] : [{
        id: "gid://shopify/UrlRedirect/1",
        path: "/products/hat-old",
        target: "/products/hat-new",
      }]]]);
    },
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async () => ({ userErrors: [] }),
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].previousHandle, "hat-old");
  assert.equal(result.rows[0].nextHandle, "hat-new");
  assert.equal(result.rows[0].redirectPath, "/products/hat-old");
  assert.equal(result.rows[0].redirectTarget, "/products/hat-new");
  const snapshotPut = puts.find((entry) => String(entry.key).endsWith("snapshot.json"));
  assert.ok(snapshotPut);
  const snapshotPayload = JSON.parse(String(snapshotPut.body));
  assert.equal(snapshotPayload.rows[0].redirectPath, "/products/hat-old");
  assert.equal(snapshotPayload.rows[0].redirectTarget, "/products/hat-new");
});

test("product write worker skips legacy handle rows already applied in live Shopify", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  let updateCalls = 0;
  const puts = [];

  const result = await runProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest-applied-handle",
            profile: "product-core-seo-v1",
            rows: [{
              changedFields: ["handle"],
              currentRow: {
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
              editedRow: {
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
              productId: "gid://shopify/Product/1",
            }],
            summary: { error: 0, total: 1 },
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
          body: args.body,
        };
      },
    },
    job: {
      id: "write-job-applied-handle",
      payload: {
        previewArtifactId: "preview-artifact-applied-handle",
        previewDigest: "preview-digest-applied-handle",
        previewJobId: "preview-job-applied-handle",
        profile: "product-core-seo-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-applied-handle",
            kind: "product.preview.result",
            objectKey: "preview/result-applied-handle.json",
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
    readLiveRedirects: async () => new Map(),
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async () => {
      updateCalls += 1;
      return { userErrors: [] };
    },
  });

  assert.equal(updateCalls, 0);
  assert.equal(result.outcome, "verified_success");
  assert.equal(result.summary.total, 0);
  assert.equal(result.rows.length, 0);
  assert.ok(!("snapshotArtifactId" in result));
  assert.equal(puts.length, 1);
  assert.ok(!("snapshotArtifactId" in puts[0].metadata));
});

test("product write worker keeps handle rows rollbackable when redirect verification fails", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const puts = [];
  let productReadCount = 0;
  let updateInput = null;

  const result = await runProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return {
          id: args.kind === "product.write.snapshot" ? "snapshot-artifact-handle-partial" : `${args.kind}-record`,
          ...args,
        };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest-handle-partial",
            profile: "product-core-seo-v1",
            rows: [{
              changedFields: ["handle"],
              currentRow: {
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
              editedRow: {
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
              nextHandle: "hat-new",
              previousHandle: "hat-old",
              productId: "gid://shopify/Product/1",
              redirectAction: "create",
              redirectPath: "/products/hat-old",
              redirectTarget: "/products/hat-new",
            }],
            summary: { error: 0, total: 1 },
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
      id: "write-job-handle-partial",
      payload: {
        previewArtifactId: "preview-artifact-handle-partial",
        previewDigest: "preview-digest-handle-partial",
        previewJobId: "preview-job-handle-partial",
        profile: "product-core-seo-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-handle-partial",
            kind: "product.preview.result",
            objectKey: "preview/result-handle-partial.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveProducts: async () => {
      productReadCount += 1;
      return new Map([["gid://shopify/Product/1", {
        body_html: "",
        handle: productReadCount === 1 ? "hat-old" : "hat-new",
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

  assert.equal(updateInput.redirectNewHandle, true);
  assert.equal(result.outcome, "partial_failure");
  assert.equal(result.summary.rollbackableRowCount, 1);
  assert.equal(result.rows[0].rollbackableHandleChange, true);
  assert.equal(result.rows[0].redirectCleanupMode, "lookup-by-path-target-or-none");
  assert.equal(result.rows[0].verificationStatus, "failed");
  const resultPut = puts.find((entry) => String(entry.key).endsWith("result.json"));
  assert.ok(resultPut);
  assert.equal(resultPut.metadata.outcome, "partial_failure");
  assert.equal(resultPut.metadata.rollbackableRowCount, 1);
});

test("product write worker keeps normalized handle rows rollbackable after transport errors when final state applied", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const puts = [];
  let productReadCount = 0;
  let redirectReadCount = 0;
  let updateCalls = 0;

  await assert.rejects(
    runProductWriteJob({
      artifactCatalog: {
        async record(args) {
          return {
            id: args.kind === "product.write.snapshot" ? "snapshot-artifact-handle-timeout" : `${args.kind}-record`,
            ...args,
          };
        },
      },
      artifactStorage: {
        async get() {
          return {
            body: Buffer.from(JSON.stringify({
              previewDigest: "preview-digest-handle-timeout",
              profile: "product-core-seo-v1",
              rows: [{
                changedFields: ["handle"],
                currentRow: {
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
                editedRow: {
                  body_html: "",
                  handle: "HAT-NEW",
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
                nextHandle: "hat-new",
                previousHandle: "hat-old",
                productId: "gid://shopify/Product/1",
                redirectAction: "create",
                redirectPath: "/products/hat-old",
                redirectTarget: "/products/hat-new",
              }],
              summary: { error: 0, total: 1 },
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
        id: "write-job-handle-timeout",
        payload: {
          previewArtifactId: "preview-artifact-handle-timeout",
          previewDigest: "preview-digest-handle-timeout",
          previewJobId: "preview-job-handle-timeout",
          profile: "product-core-seo-v1",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst() {
            return {
              id: "preview-artifact-handle-timeout",
              kind: "product.preview.result",
              objectKey: "preview/result-handle-timeout.json",
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
      readLiveProducts: async () => {
        productReadCount += 1;
        return new Map([["gid://shopify/Product/1", {
          body_html: "",
          handle: productReadCount === 1 ? "hat-old" : "hat-new",
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
      readLiveRedirects: async () => {
        redirectReadCount += 1;
        return new Map([["/products/hat-old", redirectReadCount === 1 ? [] : [{
          id: "gid://shopify/UrlRedirect/1",
          path: "/products/hat-old",
          target: "/products/hat-new",
        }]]]);
      },
      resolveAdminContext: async () => ({ admin: {} }),
      updateProduct: async () => {
        updateCalls += 1;
        throw new Error("socket timeout");
      },
    }),
    /socket timeout/,
  );

  assert.equal(updateCalls, 1);
  assert.equal(puts.length, 3);
  const resultPayload = JSON.parse(String(puts[1].body));
  assert.equal(resultPayload.outcome, "verified_success");
  assert.equal(resultPayload.summary.rollbackableRowCount, 1);
  assert.equal(resultPayload.rows[0].mutationStatus, "failed");
  assert.equal(resultPayload.rows[0].rollbackableHandleChange, true);
  assert.equal(resultPayload.rows[0].verificationStatus, "verified");
});

test("preview page exposes write and undo controls", () => {
  const route = readProjectFile("app/routes/app.preview.tsx");
  assert.match(route, /product-variants-v1/);
  assert.match(route, /product-variants-prices-v1/);
  assert.match(route, /Create export/);
  assert.match(route, /product-media-v1/);
  assert.match(route, /Confirm and write/);
  assert.match(route, /Undo latest rollbackable write/);
  assert.match(route, /previewJobId/);
  assert.match(route, /writeJobId/);
  assert.match(route, /undoJobId/);
});
