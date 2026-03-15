import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  findLatestSuccessfulProductWriteArtifact,
  findVerifiedSuccessfulProductWriteArtifactByPreviewJobId,
} from "../../domain/products/write-jobs.mjs";
import {
  buildProductUpdateInputFromPreviewRow,
  getWritablePreviewRows,
} from "../../domain/products/write-rows.mjs";
import { buildVariantPriceMutationFromPreviewRow } from "../../domain/variant-prices/write-rows.mjs";
import { buildVariantMutationFromPreviewRow } from "../../domain/variants/write-rows.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

async function importProductWriteWorker() {
  return import("../../workers/product-write.mjs");
}

async function importVariantProductWriteWorker() {
  return import("../../workers/product-write-variants.mjs");
}

async function importInventoryProductWriteWorker() {
  return import("../../workers/product-write-inventory.mjs");
}

async function importProductUndoWorker() {
  return import("../../workers/product-undo.mjs");
}

async function importMissingOfflineSessionError() {
  return import("../../workers/offline-admin.mjs");
}

test("writable preview rows are determined by changedFields", () => {
  assert.deepEqual(
    getWritablePreviewRows([
      { changedFields: [] },
      { changedFields: ["vendor"], productId: "gid://shopify/Product/1" },
    ]).map((row) => row.productId),
    ["gid://shopify/Product/1"],
  );
});

test("write row mutation input canonicalizes tags and seo", () => {
  const result = buildProductUpdateInputFromPreviewRow({
    changedFields: ["tags", "seo_title"],
    editedRow: {
      product_id: "gid://shopify/Product/1",
      seo_description: "Desc",
      seo_title: "Title",
      tags: "sale, featured ,  spring ",
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.input.tags, ["sale", "featured", "spring"]);
  assert.deepEqual(result.input.seo, {
    description: "Desc",
    title: "Title",
  });
});

test("changed-fields verification normalizes tags before comparison", async () => {
  const { changedFieldsMatch } = await import("../../domain/products/write-rows.mjs");

  assert.equal(
    changedFieldsMatch({
      actualRow: { tags: "sale, featured" },
      changedFields: ["tags"],
      expectedRow: { tags: "sale,featured" },
    }),
    true,
  );
  assert.equal(
    changedFieldsMatch({
      actualRow: { tags: "sale, featured" },
      changedFields: ["tags"],
      expectedRow: { tags: "sale, other" },
    }),
    false,
  );
});

test("changed-fields verification normalizes status before comparison", async () => {
  const { changedFieldsMatch } = await import("../../domain/products/write-rows.mjs");

  assert.equal(
    changedFieldsMatch({
      actualRow: { status: "ACTIVE" },
      changedFields: ["status"],
      expectedRow: { status: "active" },
    }),
    true,
  );
});

test("invalid status is a row business failure instead of route reject", () => {
  const result = buildProductUpdateInputFromPreviewRow({
    changedFields: ["status"],
    editedRow: {
      product_id: "gid://shopify/Product/1",
      status: "INVALID",
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /invalid status value/);
});

test("variant write input preserves blank SKU clears", () => {
  const result = buildVariantMutationFromPreviewRow({
    changedFields: ["sku"],
    editedRow: {
      variant_id: "gid://shopify/ProductVariant/1",
      sku: "",
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.input.inventoryItem, {
    sku: "",
  });
});

test("variant price write input clears compare-at when edited to blank", () => {
  const result = buildVariantPriceMutationFromPreviewRow({
    changedFields: ["compare_at_price"],
    editedRow: {
      compare_at_price: "",
      variant_id: "gid://shopify/ProductVariant/1",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.input.compareAtPrice, null);
});

test("variant price write input rejects blank price changes", () => {
  const result = buildVariantPriceMutationFromPreviewRow({
    changedFields: ["price"],
    editedRow: {
      price: "",
      variant_id: "gid://shopify/ProductVariant/1",
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /price cannot be blank/);
});

test("variant price write input accepts three-decimal money values", () => {
  const result = buildVariantPriceMutationFromPreviewRow({
    changedFields: ["price", "compare_at_price"],
    editedRow: {
      compare_at_price: "11.125",
      price: "10.500",
      variant_id: "gid://shopify/ProductVariant/1",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.input.id, "gid://shopify/ProductVariant/1");
  assert.equal(result.input.price, "10.5");
  assert.equal(result.input.compareAtPrice, "11.125");
});

test("latest rollbackable write lookup includes partial_failure with snapshot metadata", async () => {
  const artifact = await findLatestSuccessfulProductWriteArtifact({
    prisma: {
      artifact: {
        async findMany(args) {
          if (args.skip > 0) {
            return [];
          }
          return [
            {
              id: "artifact-1",
              jobId: "job-1",
              metadata: {
                outcome: "partial_failure",
                profile: "product-core-seo-v1",
                snapshotArtifactId: "snapshot-1",
              },
            },
          ];
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(artifact.id, "artifact-1");
});

test("latest successful write lookup scans past the first 100 artifacts", async () => {
  let call = 0;
  const artifact = await findLatestSuccessfulProductWriteArtifact({
    prisma: {
      artifact: {
        async findMany(args) {
          call += 1;
          if (args.where.kind === "product.undo.result") {
            return [];
          }

          if (args.skip === 0) {
            return Array.from({ length: 100 }, (_, index) => ({
              id: `artifact-failed-${index}`,
              jobId: `job-failed-${index}`,
              metadata: { outcome: "verified_failure", profile: "product-core-seo-v1" },
            }));
          }

          if (args.skip > 100) {
            return [];
          }

          return [{
            id: "artifact-success-101",
            jobId: "job-success-101",
            metadata: {
              outcome: "verified_success",
              profile: "product-core-seo-v1",
              snapshotArtifactId: "snapshot-success-101",
            },
          }];
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(call, 4);
  assert.equal(artifact.id, "artifact-success-101");
});

test("verified successful write lookup matches previewJobId even when a newer write exists", async () => {
  const artifact = await findVerifiedSuccessfulProductWriteArtifactByPreviewJobId({
    previewJobId: "preview-job-a",
    prisma: {
      artifact: {
        async findMany(args) {
          if (args.skip > 0) {
            return [];
          }
          return [
            {
              id: "artifact-newer",
              jobId: "write-job-b",
              metadata: {
                outcome: "verified_success",
                previewJobId: "preview-job-b",
                profile: "product-core-seo-v1",
              },
            },
            {
              id: "artifact-target",
              jobId: "write-job-a",
              metadata: {
                outcome: "verified_success",
                previewJobId: "preview-job-a",
                profile: "product-core-seo-v1",
              },
            },
          ];
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(artifact?.id, "artifact-target");
});

test("latest successful write lookup excludes writes already undone successfully", async () => {
  const artifact = await findLatestSuccessfulProductWriteArtifact({
    prisma: {
      artifact: {
        async findMany(args) {
          if (args.where.kind === "product.undo.result") {
            if (args.skip > 0) {
              return [];
            }
            return [
              {
                id: "undo-artifact-1",
                jobId: "undo-job-1",
                metadata: {
                  outcome: "verified_success",
                  profile: "product-core-seo-v1",
                  writeJobId: "write-job-2",
                },
              },
            ];
          }

          if (args.skip > 0) {
            return [];
          }

          return [
            {
              id: "write-artifact-2",
              jobId: "write-job-2",
              metadata: {
                outcome: "verified_success",
                previewJobId: "preview-job-2",
                profile: "product-core-seo-v1",
                snapshotArtifactId: "snapshot-2",
              },
            },
            {
              id: "write-artifact-1",
              jobId: "write-job-1",
              metadata: {
                outcome: "partial_failure",
                previewJobId: "preview-job-1",
                profile: "product-core-seo-v1",
                snapshotArtifactId: "snapshot-1",
              },
            },
          ];
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(artifact?.id, "write-artifact-1");
});

test("latest successful write lookup ignores variant profile writes without rollbackable metadata", async () => {
  const artifact = await findLatestSuccessfulProductWriteArtifact({
    prisma: {
      artifact: {
        async findMany(args) {
          if (args.where.kind === "product.undo.result") {
            return [];
          }

          if (args.skip > 0) {
            return [];
          }

          return [
            {
              id: "variant-write-artifact",
              jobId: "variant-write-job",
              metadata: {
                outcome: "verified_success",
                profile: "product-variants-v1",
              },
            },
            {
              id: "core-write-artifact",
              jobId: "core-write-job",
              metadata: {
                outcome: "verified_success",
                profile: "product-core-seo-v1",
                snapshotArtifactId: "snapshot-1",
              },
            },
          ];
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(artifact?.id, "core-write-artifact");
});

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
              messages: ["Live Shopify inventory level changed after the selected export baseline"],
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
              rows: [],
              summary: { error: 0, total: 0 },
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
      readLiveProducts: async () => new Map(),
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

test("preview page exposes write and undo controls", () => {
  const route = readProjectFile("app/routes/app.preview.tsx");
  assert.match(route, /product-variants-v1/);
  assert.match(route, /product-variants-prices-v1/);
  assert.match(route, /Create export/);
  assert.match(route, /Confirm and write/);
  assert.match(route, /Undo latest rollbackable write/);
  assert.match(route, /previewJobId/);
  assert.match(route, /writeJobId/);
  assert.match(route, /undoJobId/);
});
