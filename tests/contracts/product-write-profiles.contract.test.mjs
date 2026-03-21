import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVariantPriceMutationFromPreviewRow,
  findLatestSuccessfulProductWriteArtifact,
  importCollectionProductWriteWorker,
  importInventoryProductWriteWorker,
  importMissingOfflineSessionError,
  importProductWriteWorker,
  importVariantProductWriteWorker,
} from "./product-write-test-helpers.mjs";

test("variant write worker stores revalidation_failed result when create rows no longer match live option schema", async () => {
  const { runVariantProductWriteJob } = await importVariantProductWriteWorker();
  const puts = [];
  let createCalls = 0;

  const result = await runVariantProductWriteJob({
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
            previewJobId: "preview-job-variant-1",
            profile: "product-variants-v1",
            rows: [{
              changedFields: ["option1_value", "sku", "taxable", "requires_shipping", "inventory_policy"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                barcode: "",
                command: "CREATE",
                inventory_policy: "DENY",
                option1_name: "Color",
                option1_value: "Red",
                option2_name: "",
                option2_value: "",
                option3_name: "",
                option3_value: "",
                product_handle: "shirt",
                product_id: "gid://shopify/Product/1",
                requires_shipping: "true",
                sku: "SKU-1",
                taxable: "true",
                updated_at: "",
                variant_id: "",
              },
              editedRowNumber: 2,
              messages: [],
              operation: "create",
              productId: "gid://shopify/Product/1",
              sourceRowNumber: null,
              variantId: null,
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
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
      id: "variant-write-job-1",
      payload: {
        previewArtifactId: "preview-artifact-1",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-variant-1",
        profile: "product-variants-v1",
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
    createVariants: async () => {
      createCalls += 1;
      return { productVariants: [], userErrors: [] };
    },
    readLiveVariants: async () => ({
      productsById: new Map([
        ["gid://shopify/Product/1", {
          handle: "shirt",
          id: "gid://shopify/Product/1",
          options: [{ name: "Shade", position: 1 }],
        }],
      ]),
      variantsByProductId: new Map([
        ["gid://shopify/Product/1", []],
      ]),
    }),
    resolveAdminContext: async () => ({ admin: {} }),
  });

  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(createCalls, 0);
  assert.equal(puts.length, 1);
  assert.match(String(puts[0].key), /result\.json$/);
});

test("inventory write worker stores revalidation_failed result when preview has no writable rows", async () => {
  const { runInventoryProductWriteJob } = await importInventoryProductWriteWorker();
  const puts = [];
  let readLiveCalls = 0;
  let updateCalls = 0;

  const result = await runInventoryProductWriteJob({
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
            previewJobId: "preview-job-inventory-1",
            profile: "product-inventory-v1",
            rows: [{
              changedFields: ["available"],
              classification: "warning",
              currentRow: {
                available: "9",
                inventory_item_id: "gid://shopify/InventoryItem/1",
                location_id: "gid://shopify/Location/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                available: "12",
              },
              editedRowNumber: 2,
              locationId: "gid://shopify/Location/1",
              messages: ["選択したエクスポート baseline 以降に、Shopify 上の最新の在庫レベルが変更されました"],
              operation: "update",
              productId: "gid://shopify/Product/1",
              variantId: "gid://shopify/ProductVariant/1",
            }],
            summary: { changed: 0, error: 0, total: 1, unchanged: 0, warning: 1 },
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
      id: "inventory-write-job-1",
      payload: {
        previewArtifactId: "preview-artifact-1",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-inventory-1",
        profile: "product-inventory-v1",
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
    readLiveInventory: async () => {
      readLiveCalls += 1;
      return { rowsByKey: new Map() };
    },
    resolveAdminContext: async () => ({ admin: {} }),
    setInventoryQuantities: async () => {
      updateCalls += 1;
      return { userErrors: [] };
    },
  });

  assert.equal(result.outcome, "revalidation_failed");
  assert.deepEqual(result.rows, []);
  assert.equal(result.summary.total, 0);
  assert.equal(readLiveCalls, 0);
  assert.equal(updateCalls, 0);
  assert.equal(puts.length, 1);
  assert.match(String(puts[0].key), /result\.json$/);
});

test("inventory write worker stores snapshotArtifactId in result artifact metadata", async () => {
  const { runInventoryProductWriteJob } = await importInventoryProductWriteWorker();
  const puts = [];
  let liveReadCount = 0;

  const result = await runInventoryProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-1", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-inventory-2",
            profile: "product-inventory-v1",
            rows: [{
              changedFields: ["available"],
              classification: "changed",
              currentRow: {
                available: "10",
                inventory_item_id: "gid://shopify/InventoryItem/1",
                location_id: "gid://shopify/Location/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                available: "12",
              },
              editedRowNumber: 2,
              locationId: "gid://shopify/Location/1",
              messages: [],
              operation: "update",
              productId: "gid://shopify/Product/1",
              variantId: "gid://shopify/ProductVariant/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
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
      id: "inventory-write-job-2",
      payload: {
        previewArtifactId: "preview-artifact-2",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-inventory-2",
        profile: "product-inventory-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-2",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveInventory: async () => {
      liveReadCount += 1;
      return {
        rowsByKey: new Map([
          ["gid://shopify/ProductVariant/1\u001egid://shopify/Location/1", {
            available: liveReadCount === 1 ? "10" : "12",
            inventory_item_id: "gid://shopify/InventoryItem/1",
            location_id: "gid://shopify/Location/1",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({ admin: {} }),
    setInventoryQuantities: async () => ({ userErrors: [] }),
  });

  assert.equal(result.outcome, "verified_success");
  const resultPut = puts.find((entry) => String(entry.key).endsWith("result.json"));
  assert.ok(resultPut);
  assert.equal(resultPut.metadata.snapshotArtifactId, "snapshot-artifact-1");
});

test("product write worker dispatches variant price profile and verifies compare-at clears", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const puts = [];
  let readCount = 0;

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
            previewDigest: "preview-digest-price",
            profile: "product-variants-prices-v1",
            rows: [{
              classification: "changed",
              changedFields: ["price", "compare_at_price"],
              currentRow: {
                compare_at_price: "12.00",
                option1_name: "Color",
                option1_value: "Red",
                option2_name: "",
                option2_value: "",
                option3_name: "",
                option3_value: "",
                price: "10.00",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                updated_at: "2026-03-14T00:00:00Z",
                variant_id: "gid://shopify/ProductVariant/1",
              },
              editedRow: {
                compare_at_price: "",
                option1_name: "Color",
                option1_value: "Red",
                option2_name: "",
                option2_value: "",
                option3_name: "",
                option3_value: "",
                price: "11.00",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                updated_at: "2026-03-14T00:00:00Z",
                variant_id: "gid://shopify/ProductVariant/1",
              },
              editedRowNumber: 2,
              operation: "update",
              productId: "gid://shopify/Product/1",
              variantId: "gid://shopify/ProductVariant/1",
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
      id: "write-job-price-1",
      payload: {
        previewArtifactId: "preview-artifact-price-1",
        previewDigest: "preview-digest-price",
        previewJobId: "preview-job-price-1",
        profile: "product-variants-prices-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-price-1",
            kind: "product.preview.result",
            objectKey: "preview/result-price.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveProducts: async () => {
      readCount += 1;
      const liveRow = readCount === 1
        ? {
          compare_at_price: "12.00",
          option1_name: "Color",
          option1_value: "Red",
          option2_name: "",
          option2_value: "",
          option3_name: "",
          option3_value: "",
          price: "10.00",
          product_handle: "hat",
          product_id: "gid://shopify/Product/1",
          updated_at: "2026-03-14T00:00:00Z",
          variant_id: "gid://shopify/ProductVariant/1",
        }
        : {
          compare_at_price: "",
          option1_name: "Color",
          option1_value: "Red",
          option2_name: "",
          option2_value: "",
          option3_name: "",
          option3_value: "",
          price: "11.0",
          product_handle: "hat",
          product_id: "gid://shopify/Product/1",
          updated_at: "2026-03-14T00:00:00Z",
          variant_id: "gid://shopify/ProductVariant/1",
        };

      return {
        variantsByProductId: new Map([
          ["gid://shopify/Product/1", [liveRow]],
        ]),
      };
    },
    resolveAdminContext: async () => ({ admin: {} }),
    updateProduct: async (_admin, input) => {
      assert.equal(input.variants[0].price, "11");
      assert.equal(input.variants[0].compareAtPrice, null);
      return { userErrors: [] };
    },
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.equal(puts.length, 2);
});

test("variant price write input targets baseline variant id even if edited row was retargeted", () => {
  const row = {
    baselineRow: {
      variant_id: "gid://shopify/ProductVariant/1",
    },
    changedFields: ["price"],
    editedRow: {
      price: "11.00",
      variant_id: "gid://shopify/ProductVariant/2",
    },
    variantId: "gid://shopify/ProductVariant/1",
  };

  const mutation = buildVariantPriceMutationFromPreviewRow(row);

  assert.equal(mutation.ok, true);
  assert.equal(mutation.input.id, "gid://shopify/ProductVariant/1");
  assert.equal(mutation.input.price, "11");
});

test("product write worker preserves missing-offline-session code when deps are injected", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const { MissingOfflineSessionError } = await importMissingOfflineSessionError();
  const puts = [];

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
        id: "write-job-missing-session",
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
      readLiveProducts: async () => new Map([["gid://shopify/Product/1", {
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
      }]]),
      readLiveRedirects: async () => new Map(),
      resolveAdminContext: async () => {
        throw new MissingOfflineSessionError("example.myshopify.com");
      },
      updateProduct: async () => ({ userErrors: [] }),
    }),
    (error) => error?.code === "missing-offline-session",
  );

  assert.equal(puts.length, 1);
  assert.match(String(puts[0].key), /error\.json$/);
  assert.equal(JSON.parse(String(puts[0].body)).code, "missing-offline-session");
  assert.equal(puts[0].metadata.code, "missing-offline-session");
});

test("product write worker uses metafield-specific dependencies without reusing product-core DI", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const puts = [];
  let metafieldReadCount = 0;
  let metafieldWriteCount = 0;

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
            previewDigest: "preview-digest-metafield",
            profile: "product-metafields-v1",
            rows: [{
              changedFields: ["value"],
              classification: "changed",
              currentRow: {
                key: "rank",
                namespace: "custom",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                type: "number_integer",
                updated_at: "2026-03-15T00:00:00Z",
                value: "1",
              },
              editedRow: {
                key: "rank",
                namespace: "custom",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                type: "number_integer",
                updated_at: "2026-03-15T00:00:00Z",
                value: "9007199254740993",
              },
              editedRowNumber: 2,
              key: "rank",
              namespace: "custom",
              operation: "update",
              productId: "gid://shopify/Product/1",
              type: "number_integer",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
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
      id: "write-job-metafield-1",
      payload: {
        previewArtifactId: "preview-artifact-metafield-1",
        previewDigest: "preview-digest-metafield",
        previewJobId: "preview-job-metafield-1",
        profile: "product-metafields-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-metafield-1",
            kind: "product.preview.result",
            objectKey: "preview/result-metafield.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMetafields: async () => {
      metafieldReadCount += 1;
      const value = metafieldReadCount === 1 ? "1" : "9007199254740993";
      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001ecustom\u001erank", {
            key: "rank",
            namespace: "custom",
            product_handle: "hat",
            product_id: "gid://shopify/Product/1",
            type: "number_integer",
            updated_at: "2026-03-15T00:00:00Z",
            value,
          }],
        ]),
      };
    },
    readLiveProducts: async () => {
      throw new Error("product-core readLiveProducts should not be used for metafield writes");
    },
    resolveAdminContext: async () => ({ admin: {} }),
    setMetafields: async (_admin, input) => {
      metafieldWriteCount += 1;
      assert.equal(input.metafields[0].value, "9007199254740993");
      return { userErrors: [] };
    },
    updateProduct: async () => {
      throw new Error("product-core updateProduct should not be used for metafield writes");
    },
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.equal(metafieldReadCount, 2);
  assert.equal(metafieldWriteCount, 1);
  assert.equal(puts.length, 2);
  const resultPut = puts.find((entry) => String(entry.key).endsWith("result.json"));
  assert.ok(resultPut);
  assert.ok(!("snapshotArtifactId" in resultPut.metadata));
});

test("latest rollbackable write lookup excludes metafield writes without rollback metadata", async () => {
  const artifact = await findLatestSuccessfulProductWriteArtifact({
    prisma: {
      artifact: {
        async findMany(args) {
          if (args.skip > 0) {
            return [];
          }

          if (args.where.kind === "product.undo.result") {
            return [];
          }

          return [{
            id: "artifact-metafield-success",
            jobId: "job-metafield-success",
            metadata: {
              outcome: "verified_success",
              profile: "product-metafields-v1",
            },
          }];
        },
      },
    },
    profile: "product-metafields-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(artifact, null);
});

test("metafield write worker persists partial result before rethrowing infrastructure failure", async () => {
  const { runProductWriteJob } = await importProductWriteWorker();
  const puts = [];
  let metafieldCallCount = 0;
  let liveReadCount = 0;

  await assert.rejects(
    runProductWriteJob({
      artifactCatalog: {
        async record(args) {
          if (args.kind === "product.write.snapshot") {
            return { id: "snapshot-artifact-metafield-2", ...args };
          }
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          return {
            body: Buffer.from(JSON.stringify({
              previewDigest: "preview-digest-metafield-2",
              profile: "product-metafields-v1",
              rows: Array.from({ length: 26 }, (_value, index) => ({
                changedFields: ["value"],
                classification: "changed",
                currentRow: {
                  key: `rank-${index + 1}`,
                  namespace: "custom",
                  product_handle: "hat",
                  product_id: "gid://shopify/Product/1",
                  type: "number_integer",
                  updated_at: "2026-03-15T00:00:00Z",
                  value: String(index + 1),
                },
                editedRow: {
                  key: `rank-${index + 1}`,
                  namespace: "custom",
                  product_handle: "hat",
                  product_id: "gid://shopify/Product/1",
                  type: "number_integer",
                  updated_at: "2026-03-15T00:00:00Z",
                  value: String(index + 101),
                },
                editedRowNumber: index + 2,
                key: `rank-${index + 1}`,
                namespace: "custom",
                operation: "update",
                productId: "gid://shopify/Product/1",
                type: "number_integer",
              })),
              summary: { changed: 26, error: 0, total: 26, unchanged: 0, warning: 0 },
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
        id: "write-job-metafield-2",
        payload: {
          previewArtifactId: "preview-artifact-metafield-2",
          previewDigest: "preview-digest-metafield-2",
          previewJobId: "preview-job-metafield-2",
          profile: "product-metafields-v1",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst() {
            return {
              id: "preview-artifact-metafield-2",
              kind: "product.preview.result",
              objectKey: "preview/result-metafield-2.json",
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
      readLiveMetafields: async () => {
        liveReadCount += 1;
        return {
          rowsByKey: new Map(
            Array.from({ length: 26 }, (_value, index) => [
              `gid://shopify/Product/1\u001ecustom\u001erank-${index + 1}`,
              {
                key: `rank-${index + 1}`,
                namespace: "custom",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                type: "number_integer",
                updated_at: "2026-03-15T00:00:00Z",
                value: String(liveReadCount === 1
                  ? index + 1
                  : (index < 25 ? index + 101 : index + 1)),
              },
            ]),
          ),
        };
      },
      resolveAdminContext: async () => ({ admin: {} }),
      setMetafields: async () => {
        metafieldCallCount += 1;
        if (metafieldCallCount === 2) {
          throw new Error("metafieldsSet transport failed");
        }
        return { userErrors: [] };
      },
    }),
    /metafieldsSet transport failed/,
  );

  assert.equal(puts.length, 3);
  const resultPut = puts.find((entry) => String(entry.key).endsWith("result.json"));
  const errorPut = puts.find((entry) => String(entry.key).endsWith("error.json"));
  assert.ok(resultPut);
  assert.ok(errorPut);
  assert.equal(metafieldCallCount, 2);
  assert.equal(liveReadCount, 2);
  assert.equal(JSON.parse(String(resultPut.body)).outcome, "partial_failure");
  assert.equal(resultPut.metadata.outcome, "partial_failure");
  assert.equal(JSON.parse(String(errorPut.body)).resultOutcome, "partial_failure");
});

test("collection write worker verifies rows after transport errors before persisting the result", async () => {
  const { runCollectionProductWriteJob } = await importCollectionProductWriteWorker();
  const puts = [];
  let liveReadCount = 0;

  await assert.rejects(
    runCollectionProductWriteJob({
      artifactCatalog: {
        async record(args) {
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          return {
            body: Buffer.from(JSON.stringify({
              previewDigest: "preview-digest-collections-1",
              previewJobId: "preview-job-collections-1",
              profile: "product-manual-collections-v1",
              rows: [{
                changedFields: ["membership"],
                classification: "changed",
                currentRow: null,
                editedRow: {
                  collection_handle: "summer",
                  collection_id: "gid://shopify/Collection/1",
                  collection_title: "Summer",
                  membership: "member",
                  product_handle: "hat",
                  product_id: "gid://shopify/Product/1",
                  updated_at: "2026-03-15T00:00:00Z",
                },
                editedRowNumber: 2,
                operation: "add",
                productId: "gid://shopify/Product/1",
                resolvedCollectionId: "gid://shopify/Collection/1",
              }],
              summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
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
        async delete() {},
      },
      job: {
        id: "write-job-collections-1",
        payload: {
          previewArtifactId: "preview-artifact-collections-1",
          previewDigest: "preview-digest-collections-1",
          previewJobId: "preview-job-collections-1",
          profile: "product-manual-collections-v1",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst() {
            return {
              id: "preview-artifact-collections-1",
              kind: "product.preview.result",
              objectKey: "preview/result-collections-1.json",
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
      readLiveCollections: async () => {
        liveReadCount += 1;
        return {
          currentRowsByKey: new Map(liveReadCount >= 2
            ? [[
              "gid://shopify/Product/1\u001egid://shopify/Collection/1",
              {
                collection_handle: "summer",
                collection_id: "gid://shopify/Collection/1",
                collection_title: "Summer",
                membership: "member",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                updated_at: "2026-03-15T00:00:00Z",
              },
            ]]
            : []),
        };
      },
      resolveAdminContext: async () => ({ admin: {} }),
      resolveHandles: async () => new Map([
        ["summer", {
          handle: "summer",
          id: "gid://shopify/Collection/1",
          title: "Summer",
        }],
      ]),
      resolveIds: async () => new Map([
        ["gid://shopify/Collection/1", {
          handle: "summer",
          id: "gid://shopify/Collection/1",
          title: "Summer",
        }],
      ]),
      addMemberships: async () => {
        throw new Error("collectionAddProductsV2 transport failed");
      },
      removeMemberships: async () => {
        throw new Error("unexpected removeMemberships call");
      },
    }),
    /collectionAddProductsV2 transport failed/,
  );

  const resultPut = puts.find((entry) => String(entry.key).endsWith("result.json"));
  assert.ok(resultPut);
  const result = JSON.parse(String(resultPut.body));
  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.equal(result.rows[0].mutationStatus, "failed");
  assert.equal(liveReadCount, 2);
});

test("collection write worker emits skipped rows for groups not processed after an earlier infrastructure failure", async () => {
  const { runCollectionProductWriteJob } = await importCollectionProductWriteWorker();
  const puts = [];

  await assert.rejects(
    runCollectionProductWriteJob({
      artifactCatalog: {
        async record(args) {
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          return {
            body: Buffer.from(JSON.stringify({
              previewDigest: "preview-digest-collections-2",
              previewJobId: "preview-job-collections-2",
              profile: "product-manual-collections-v1",
              rows: [
                {
                  changedFields: ["membership"],
                  classification: "changed",
                  currentRow: null,
                  editedRow: {
                    collection_handle: "summer",
                    collection_id: "gid://shopify/Collection/1",
                    collection_title: "Summer",
                    membership: "member",
                    product_handle: "hat",
                    product_id: "gid://shopify/Product/1",
                    updated_at: "2026-03-15T00:00:00Z",
                  },
                  editedRowNumber: 2,
                  operation: "add",
                  productId: "gid://shopify/Product/1",
                  resolvedCollectionId: "gid://shopify/Collection/1",
                },
                {
                  changedFields: ["membership"],
                  classification: "changed",
                  currentRow: null,
                  editedRow: {
                    collection_handle: "winter",
                    collection_id: "gid://shopify/Collection/2",
                    collection_title: "Winter",
                    membership: "member",
                    product_handle: "hat",
                    product_id: "gid://shopify/Product/1",
                    updated_at: "2026-03-15T00:00:00Z",
                  },
                  editedRowNumber: 3,
                  operation: "add",
                  productId: "gid://shopify/Product/1",
                  resolvedCollectionId: "gid://shopify/Collection/2",
                },
              ],
              summary: { changed: 2, error: 0, total: 2, unchanged: 0, warning: 0 },
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
        async delete() {},
      },
      job: {
        id: "write-job-collections-2",
        payload: {
          previewArtifactId: "preview-artifact-collections-2",
          previewDigest: "preview-digest-collections-2",
          previewJobId: "preview-job-collections-2",
          profile: "product-manual-collections-v1",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst() {
            return {
              id: "preview-artifact-collections-2",
              kind: "product.preview.result",
              objectKey: "preview/result-collections-2.json",
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
      readLiveCollections: async () => ({
        currentRowsByKey: new Map(),
      }),
      resolveAdminContext: async () => ({ admin: {} }),
      resolveHandles: async () => new Map([
        ["summer", {
          handle: "summer",
          id: "gid://shopify/Collection/1",
          title: "Summer",
        }],
        ["winter", {
          handle: "winter",
          id: "gid://shopify/Collection/2",
          title: "Winter",
        }],
      ]),
      resolveIds: async () => new Map([
        ["gid://shopify/Collection/1", {
          handle: "summer",
          id: "gid://shopify/Collection/1",
          title: "Summer",
        }],
        ["gid://shopify/Collection/2", {
          handle: "winter",
          id: "gid://shopify/Collection/2",
          title: "Winter",
        }],
      ]),
      addMemberships: async (_admin, { collectionId }) => {
        if (collectionId === "gid://shopify/Collection/1") {
          throw new Error("first collection transport failed");
        }
        throw new Error("unexpected addMemberships call");
      },
      removeMemberships: async () => {
        throw new Error("unexpected removeMemberships call");
      },
    }),
    /first collection transport failed/,
  );

  const resultPut = puts.find((entry) => String(entry.key).endsWith("result.json"));
  assert.ok(resultPut);
  const result = JSON.parse(String(resultPut.body));
  assert.equal(result.summary.total, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].verificationStatus, "verification_failed");
  assert.equal(result.rows[1].verificationStatus, "skipped");
  assert.equal(result.rows[1].mutationStatus, "skipped");
  assert.match(result.rows[1].messages[0], /Write stopped after an earlier infrastructure failure/);
});

test("collection write worker keeps sibling expanded rows even when they share the same edited row number", async () => {
  const { runCollectionProductWriteJob } = await importCollectionProductWriteWorker();
  const puts = [];

  await assert.rejects(
    runCollectionProductWriteJob({
      artifactCatalog: {
        async record(args) {
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          return {
            body: Buffer.from(JSON.stringify({
              previewDigest: "preview-digest-collections-4",
              previewJobId: "preview-job-collections-4",
              profile: "product-manual-collections-v1",
              rows: [
                {
                  changedFields: ["membership"],
                  classification: "changed",
                  currentRow: null,
                  editedRow: {
                    collection_handle: "summer",
                    collection_id: "gid://shopify/Collection/1",
                    collection_title: "Summer",
                    membership: "member",
                    product_handle: "hat",
                    product_id: "gid://shopify/Product/1",
                    updated_at: "2026-03-15T00:00:00Z",
                  },
                  editedRowNumber: 2,
                  operation: "add",
                  productId: "gid://shopify/Product/1",
                  resolvedCollectionId: "gid://shopify/Collection/1",
                },
                {
                  changedFields: ["membership"],
                  classification: "changed",
                  currentRow: null,
                  editedRow: {
                    collection_handle: "winter",
                    collection_id: "gid://shopify/Collection/2",
                    collection_title: "Winter",
                    membership: "member",
                    product_handle: "hat",
                    product_id: "gid://shopify/Product/1",
                    updated_at: "2026-03-15T00:00:00Z",
                  },
                  editedRowNumber: 2,
                  operation: "add",
                  productId: "gid://shopify/Product/1",
                  resolvedCollectionId: "gid://shopify/Collection/2",
                },
              ],
              summary: { changed: 2, error: 0, total: 2, unchanged: 0, warning: 0 },
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
        async delete() {},
      },
      job: {
        id: "write-job-collections-4",
        payload: {
          previewArtifactId: "preview-artifact-collections-4",
          previewDigest: "preview-digest-collections-4",
          previewJobId: "preview-job-collections-4",
          profile: "product-manual-collections-v1",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst() {
            return {
              id: "preview-artifact-collections-4",
              kind: "product.preview.result",
              objectKey: "preview/result-collections-4.json",
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
      readLiveCollections: async () => ({
        currentRowsByKey: new Map(),
      }),
      resolveAdminContext: async () => ({ admin: {} }),
      resolveHandles: async () => new Map([
        ["summer", {
          handle: "summer",
          id: "gid://shopify/Collection/1",
          title: "Summer",
        }],
        ["winter", {
          handle: "winter",
          id: "gid://shopify/Collection/2",
          title: "Winter",
        }],
      ]),
      resolveIds: async () => new Map([
        ["gid://shopify/Collection/1", {
          handle: "summer",
          id: "gid://shopify/Collection/1",
          title: "Summer",
        }],
        ["gid://shopify/Collection/2", {
          handle: "winter",
          id: "gid://shopify/Collection/2",
          title: "Winter",
        }],
      ]),
      addMemberships: async (_admin, { collectionId }) => {
        if (collectionId === "gid://shopify/Collection/1") {
          throw new Error("first collection transport failed");
        }
        throw new Error("unexpected addMemberships call");
      },
      removeMemberships: async () => {
        throw new Error("unexpected removeMemberships call");
      },
    }),
    /first collection transport failed/,
  );

  const resultPut = puts.find((entry) => String(entry.key).endsWith("result.json"));
  assert.ok(resultPut);
  const result = JSON.parse(String(resultPut.body));
  assert.equal(result.summary.total, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].verificationStatus, "verification_failed");
  assert.equal(result.rows[1].verificationStatus, "skipped");
  assert.equal(result.rows[1].mutationStatus, "skipped");
  assert.equal(result.rows[1].resolvedCollectionId, "gid://shopify/Collection/2");
});

test("collection write worker fails revalidation when the confirmed handle no longer resolves to the previewed collection", async () => {
  const { runCollectionProductWriteJob } = await importCollectionProductWriteWorker();
  let addMembershipCalls = 0;

  const result = await runCollectionProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest-collections-3",
            previewJobId: "preview-job-collections-3",
            profile: "product-manual-collections-v1",
            rows: [{
              changedFields: ["membership"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                collection_handle: "summer",
                collection_id: "gid://shopify/Collection/1",
                collection_title: "Summer",
                membership: "member",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                updated_at: "",
              },
              editedRowNumber: 2,
              operation: "add",
              productId: "gid://shopify/Product/1",
              resolvedCollectionId: "gid://shopify/Collection/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
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
      async delete() {},
    },
    job: {
      id: "write-job-collections-3",
      payload: {
        previewArtifactId: "preview-artifact-collections-3",
        previewDigest: "preview-digest-collections-3",
        previewJobId: "preview-job-collections-3",
        profile: "product-manual-collections-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-collections-3",
            kind: "product.preview.result",
            objectKey: "preview/result-collections-3.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveCollections: async () => ({
      currentRowsByKey: new Map(),
    }),
    resolveAdminContext: async () => ({ admin: {} }),
    resolveHandles: async () => new Map(),
    resolveIds: async () => new Map([
      ["gid://shopify/Collection/1", {
        handle: "summer-2026",
        id: "gid://shopify/Collection/1",
        title: "Summer 2026",
      }],
    ]),
    addMemberships: async () => {
      addMembershipCalls += 1;
      return { job: null, userErrors: [] };
    },
    removeMemberships: async () => {
      throw new Error("unexpected removeMemberships call");
    },
  });

  assert.equal(addMembershipCalls, 0);
  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(result.rows[0].verificationStatus, "revalidation_failed");
  assert.match(result.rows[0].messages[0], /プレビュー確定後に、Shopify 上の最新のコレクション状態が変更されました/);
});
