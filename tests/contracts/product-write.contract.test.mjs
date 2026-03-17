import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  findLatestSuccessfulProductWriteArtifact,
  findVerifiedSuccessfulProductWriteArtifactByPreviewJobId,
} from "../../domain/products/write-jobs.mjs";
import {
  buildRollbackInputFromSnapshotRow,
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

async function importMediaProductWriteWorker() {
  return import("../../workers/product-write-media.mjs");
}

async function importCollectionProductWriteWorker() {
  return import("../../workers/product-write-collections.mjs");
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

test("handle change write input enables redirect generation", () => {
  const result = buildProductUpdateInputFromPreviewRow({
    changedFields: ["handle"],
    editedRow: {
      handle: "HAT-NEW",
      product_id: "gid://shopify/Product/1",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.input.handle, "hat-new");
  assert.equal(result.input.redirectNewHandle, true);
});

test("handle change write input rejects invalid handles instead of slugifying", () => {
  const result = buildProductUpdateInputFromPreviewRow({
    changedFields: ["handle"],
    editedRow: {
      handle: " Hat New ",
      product_id: "gid://shopify/Product/1",
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors[0], /invalid handle value/i);
});

test("rollback input never recreates reverse redirects", () => {
  const result = buildRollbackInputFromSnapshotRow({
    changedFields: ["handle"],
    preWriteRow: {
      handle: "hat-old",
      product_id: "gid://shopify/Product/1",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.input.handle, "hat-old");
  assert.equal("redirectNewHandle" in result.input, false);
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

test("changed-fields verification normalizes handles before comparison", async () => {
  const { changedFieldsMatch } = await import("../../domain/products/write-rows.mjs");

  assert.equal(
    changedFieldsMatch({
      actualRow: { handle: "hat-new" },
      changedFields: ["handle"],
      expectedRow: { handle: "HAT-NEW" },
    }),
    true,
  );
  assert.equal(
    changedFieldsMatch({
      actualRow: { handle: "hat-new" },
      changedFields: ["handle"],
      expectedRow: { handle: "Hat-Old" },
    }),
    false,
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

test("latest successful write lookup ignores no-op verified_success artifacts without snapshot metadata", async () => {
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
              id: "noop-write-artifact",
              jobId: "noop-write-job",
              metadata: {
                outcome: "verified_success",
                profile: "product-core-seo-v1",
                total: 0,
              },
            },
            {
              id: "rollbackable-write-artifact",
              jobId: "rollbackable-write-job",
              metadata: {
                outcome: "verified_success",
                profile: "product-core-seo-v1",
                snapshotArtifactId: "snapshot-rollbackable",
              },
            },
          ];
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(artifact?.id, "rollbackable-write-artifact");
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

test("media write worker does not delete existing media when replace create returns userErrors", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let deleteCalls = 0;
  const puts = [];

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-1", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-1",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
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
      id: "media-write-job-1",
      payload: {
        previewArtifactId: "preview-artifact-media-1",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-1",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-1",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/original.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [],
                      mediaUserErrors: [{ field: ["media", "0", "originalSource"], message: "Invalid image URL" }],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            deleteCalls += 1;
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(deleteCalls, 0);
  assert.equal(result.outcome, "verified_failure");
  assert.ok(!("snapshotArtifactId" in result));
  assert.equal(result.rows[0].mutationStatus, "failed");
  assert.match(result.rows[0].messages[0], /Invalid image URL/);
  const resultPut = puts.find((entry) => String(entry.key).endsWith("result.json"));
  assert.ok(resultPut);
  assert.ok(!("snapshotArtifactId" in resultPut.metadata));
});

test("media write worker rolls back newly created media when replace cannot delete the original", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const deleteCalls = [];

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-rollback", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-rollback",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-rollback",
      payload: {
        previewArtifactId: "preview-artifact-media-rollback",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-rollback",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-rollback",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/original.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            deleteCalls.push(variables.mediaIds[0]);
            return {
              ok: true,
              async json() {
                return deleteCalls.length === 1
                  ? {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: [],
                        mediaUserErrors: [{ field: ["mediaIds"], message: "Original delete failed" }],
                      },
                    },
                  }
                  : {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: ["gid://shopify/MediaImage/99"],
                        mediaUserErrors: [],
                      },
                    },
                  };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.deepEqual(deleteCalls, ["gid://shopify/MediaImage/1", "gid://shopify/MediaImage/99"]);
  assert.match(result.rows[0].messages[0], /Original delete failed/);
});

test("media write worker surfaces rollback cleanup errors when compensating delete is rejected", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const deleteCalls = [];

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-rollback-user-errors", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-rollback-user-errors",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-rollback-user-errors",
      payload: {
        previewArtifactId: "preview-artifact-media-rollback-user-errors",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-rollback-user-errors",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-rollback-user-errors",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/original.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            deleteCalls.push(variables.mediaIds[0]);
            return {
              ok: true,
              async json() {
                return deleteCalls.length === 1
                  ? {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: [],
                        mediaUserErrors: [{ field: ["mediaIds"], message: "Original delete failed" }],
                      },
                    },
                  }
                  : {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: [],
                        mediaUserErrors: [{ field: ["mediaIds"], message: "Rollback cleanup failed" }],
                      },
                    },
                  };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.deepEqual(deleteCalls, ["gid://shopify/MediaImage/1", "gid://shopify/MediaImage/99"]);
  assert.match(result.rows[0].messages[0], /Original delete failed/);
  assert.match(result.rows[0].messages[1], /Rollback cleanup failed/);
});

test("media write worker stores revalidation_failed result when live Shopify media source drifted after preview", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let updateCalls = 0;

  const result = await runMediaProductWriteJob({
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
            previewJobId: "preview-job-media-race",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_alt"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Updated alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "update",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-race",
      payload: {
        previewArtifactId: "preview-artifact-media-race",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-race",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-race",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/replaced.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductUpdateMedia")) {
            updateCalls += 1;
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productUpdateMedia: {
                      media: [],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(updateCalls, 0);
  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(result.rows[0].verificationStatus, "revalidation_failed");
  assert.match(result.rows[0].messages[0], /changed after preview confirmation was requested/);
});

test("media write worker stores revalidation_failed result when mixed-media set changed after preview", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let createCalls = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            mediaSetByProduct: {
              "gid://shopify/Product/1": [
                {
                  image_alt: "Current alt",
                  image_position: "1",
                  image_src: "https://cdn.shopify.com/original.jpg",
                  media_content_type: "IMAGE",
                  media_id: "gid://shopify/MediaImage/1",
                  product_id: "gid://shopify/Product/1",
                },
                {
                  image_alt: "Clip",
                  image_position: "2",
                  image_src: "https://cdn.shopify.com/video.jpg",
                  media_content_type: "VIDEO",
                  media_id: "gid://shopify/Video/9",
                  product_id: "gid://shopify/Product/1",
                },
              ],
            },
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-mixed-race",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-mixed-race",
      payload: {
        previewArtifactId: "preview-artifact-media-mixed-race",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-mixed-race",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-mixed-race",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      mediaSetByProduct: new Map([
        ["gid://shopify/Product/1", [
          {
            image_alt: "Current alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/original.jpg",
            media_content_type: "IMAGE",
            media_id: "gid://shopify/MediaImage/1",
            product_id: "gid://shopify/Product/1",
          },
          {
            image_alt: "Clip",
            image_position: "2",
            image_src: "https://cdn.shopify.com/video.jpg",
            media_content_type: "VIDEO",
            media_id: "gid://shopify/Video/9",
            product_id: "gid://shopify/Product/1",
          },
          {
            image_alt: "Walkthrough",
            image_position: "3",
            image_src: "https://cdn.shopify.com/new-video.jpg",
            media_content_type: "VIDEO",
            media_id: "gid://shopify/Video/10",
            product_id: "gid://shopify/Product/1",
          },
        ]],
      ]),
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/original.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            createCalls += 1;
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(createCalls, 0);
  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(result.rows[0].verificationStatus, "revalidation_failed");
  assert.match(result.rows[0].messages[0], /changed after preview confirmation was requested/);
});

test("media write worker stores revalidation_failed result when create rows no longer match the live product media set", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let createCalls = 0;

  const result = await runMediaProductWriteJob({
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
            previewJobId: "preview-job-media-create-race",
            profile: "product-media-v1",
            rows: [{
              baselineRow: {
                image_alt: "",
                image_position: "",
                image_src: "",
                media_content_type: "IMAGE",
                media_id: "",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                updated_at: "2026-03-15T00:00:00Z",
              },
              changedFields: ["image_src", "image_alt", "image_position"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                image_alt: "Created alt",
                image_position: "1",
                image_src: "https://example.com/new.jpg",
                media_content_type: "IMAGE",
                media_id: "",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                updated_at: "2026-03-15T00:00:00Z",
              },
              editedRowNumber: 2,
              mediaId: null,
              operation: "create",
              productId: "gid://shopify/Product/1",
              sourceRowNumber: 2,
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
        };
      },
    },
    job: {
      id: "media-write-job-create-race",
      payload: {
        previewArtifactId: "preview-artifact-media-create-race",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-create-race",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-create-race",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/9", {
          image_alt: "Other image",
          image_position: "1",
          image_src: "https://cdn.shopify.com/other.jpg",
          media_id: "gid://shopify/MediaImage/9",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            createCalls += 1;
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(createCalls, 0);
  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(result.rows[0].verificationStatus, "revalidation_failed");
  assert.match(result.rows[0].messages[0], /changed after preview confirmation was requested/);
});

test("media write worker rolls back newly created media when replace delete throws", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const deleteCalls = [];

  await assert.rejects(
    runMediaProductWriteJob({
      artifactCatalog: {
        async record(args) {
          if (args.kind === "product.write.snapshot") {
            return { id: "snapshot-artifact-media-delete-throw", ...args };
          }
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          return {
            body: Buffer.from(JSON.stringify({
              previewDigest: "preview-digest",
              previewJobId: "preview-job-media-delete-throw",
              profile: "product-media-v1",
              rows: [{
                changedFields: ["image_src"],
                classification: "changed",
                currentRow: {
                  image_alt: "Current alt",
                  image_position: "1",
                  image_src: "https://cdn.shopify.com/original.jpg",
                  media_id: "gid://shopify/MediaImage/1",
                  product_id: "gid://shopify/Product/1",
                },
                editedRow: {
                  image_alt: "Current alt",
                  image_position: "1",
                  image_src: "https://example.com/new.jpg",
                },
                editedRowNumber: 2,
                mediaId: "gid://shopify/MediaImage/1",
                operation: "replace",
                productId: "gid://shopify/Product/1",
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
          };
        },
      },
      job: {
        id: "media-write-job-delete-throw",
        payload: {
          previewArtifactId: "preview-artifact-media-delete-throw",
          previewDigest: "preview-digest",
          previewJobId: "preview-job-media-delete-throw",
          profile: "product-media-v1",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst() {
            return {
              id: "preview-artifact-media-delete-throw",
              kind: "product.preview.result",
              objectKey: "preview/result.json",
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
      readLiveMedia: async () => ({
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
            image_alt: "Current alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/original.jpg",
            media_id: "gid://shopify/MediaImage/1",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      }),
      resolveAdminContext: async () => ({
        admin: {
          async graphql(query, { variables } = {}) {
            if (query.includes("mutation ProductCreateMedia")) {
              return {
                ok: true,
                async json() {
                  return {
                    data: {
                      productCreateMedia: {
                        media: [{
                          alt: "Current alt",
                          id: "gid://shopify/MediaImage/99",
                          mediaContentType: "IMAGE",
                          status: "READY",
                        }],
                        mediaUserErrors: [],
                      },
                    },
                  };
                },
              };
            }

            if (query.includes("mutation ProductDeleteMedia")) {
              deleteCalls.push(variables.mediaIds[0]);
              if (deleteCalls.length === 1) {
                throw new Error("delete transport failed");
              }

              return {
                ok: true,
                async json() {
                  return {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: ["gid://shopify/MediaImage/99"],
                        mediaUserErrors: [],
                      },
                    },
                  };
                },
              };
            }

            throw new Error(`unexpected GraphQL query: ${query}`);
          },
        },
      }),
    }),
    /delete transport failed/,
  );

  assert.deepEqual(deleteCalls, ["gid://shopify/MediaImage/1", "gid://shopify/MediaImage/99"]);
});

test("media write worker waits for reorder job and reorders newly created media using created media id", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const reorderCalls = [];
  const jobReads = [];
  const sleepCalls = [];
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-2", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-2",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src", "image_position", "image_alt"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                image_alt: "Created alt",
                image_position: "2",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: null,
              operation: "create",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-2",
      payload: {
        previewArtifactId: "preview-artifact-media-2",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-2",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    mediaJobPollIntervalMs: 5,
    mediaJobPollMaxAttempts: 3,
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-2",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return { rowsByKey: new Map() };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Created alt",
            image_position: "2",
            image_src: "https://cdn.shopify.com/new.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    readMediaJob: async (_admin, { jobId }) => {
      jobReads.push(jobId);
      return jobReads.length === 1
        ? { done: false, id: jobId }
        : { done: true, id: jobId };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Created alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "UPLOADED",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            reorderCalls.push(variables.moves);
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: { done: false, id: "gid://shopify/Job/1" },
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
    sleep: async (milliseconds) => {
      sleepCalls.push(milliseconds);
    },
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].mediaId, "gid://shopify/MediaImage/99");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.deepEqual(reorderCalls, [[{ id: "gid://shopify/MediaImage/99", newPosition: 1 }]]);
  assert.deepEqual(jobReads, ["gid://shopify/Job/1", "gid://shopify/Job/1"]);
  assert.deepEqual(sleepCalls, [5]);
});

test("media write worker fails verification when created media alt does not match expected blank alt", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-create-alt", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-create-alt",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src", "image_position"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                image_alt: "",
                image_position: "2",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: null,
              operation: "create",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-create-alt",
      payload: {
        previewArtifactId: "preview-artifact-media-create-alt",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-create-alt",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-create-alt",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return { rowsByKey: new Map() };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Unexpected alt",
            image_position: "2",
            image_src: "https://cdn.shopify.com/new.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.equal(result.rows[0].verificationStatus, "failed");
  assert.match(result.rows[0].messages.at(-1), /Final-state verification failed/);
  assert.equal(liveReadCount, 2);
});

test("media write worker polls until uploaded created media becomes visible before final verification", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const sleepCalls = [];
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-3", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-3",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src", "image_alt"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                image_alt: "Created alt",
                image_position: "",
                image_src: "https://example.com/slow.jpg",
              },
              editedRowNumber: 2,
              mediaId: null,
              operation: "create",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-3",
      payload: {
        previewArtifactId: "preview-artifact-media-3",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-3",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    mediaCreatePollIntervalMs: 5,
    mediaCreatePollMaxAttempts: 3,
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-3",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount < 3) {
        return { rowsByKey: new Map() };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/123", {
            image_alt: "Created alt",
            image_position: "",
            image_src: "https://cdn.shopify.com/slow.jpg",
            media_id: "gid://shopify/MediaImage/123",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Created alt",
                        id: "gid://shopify/MediaImage/123",
                        mediaContentType: "IMAGE",
                        status: "UPLOADED",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
    sleep: async (milliseconds) => {
      sleepCalls.push(milliseconds);
    },
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.equal(liveReadCount, 3);
  assert.deepEqual(sleepCalls, [5]);
});

test("media write worker re-reads live media for final verification when no create polling is needed", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-4", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-4",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_alt"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Updated alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "update",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-4",
      payload: {
        previewArtifactId: "preview-artifact-media-4",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-4",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-4",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "1",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
            image_alt: "Updated alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/original.jpg",
            media_id: "gid://shopify/MediaImage/1",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductUpdateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productUpdateMedia: {
                      media: [{
                        alt: "Updated alt",
                        id: "gid://shopify/MediaImage/1",
                        mediaContentType: "IMAGE",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.equal(liveReadCount, 2);
});

test("media write worker skips productUpdateMedia for position-only edits and still reorders", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const reorderCalls = [];
  let updateCalls = 0;
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-position-only", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-position-only",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_position"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "2",
                image_src: "https://cdn.shopify.com/original.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "update",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-position-only",
      payload: {
        previewArtifactId: "preview-artifact-media-position-only",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-position-only",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-position-only",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "1",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
            image_alt: "Current alt",
            image_position: "2",
            image_src: "https://cdn.shopify.com/original.jpg",
            media_id: "gid://shopify/MediaImage/1",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductUpdateMedia")) {
            updateCalls += 1;
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productUpdateMedia: {
                      media: [],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            reorderCalls.push(variables.moves);
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(updateCalls, 0);
  assert.deepEqual(reorderCalls, [[{ id: "gid://shopify/MediaImage/1", newPosition: 1 }]]);
  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
});

test("media write worker reorders replace rows even when image_position was not edited", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const reorderCalls = [];
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-5", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-5",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-5",
      payload: {
        previewArtifactId: "preview-artifact-media-5",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-5",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-5",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "1",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Current alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/replacement.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            reorderCalls.push(variables.moves);
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.deepEqual(reorderCalls, [[{ id: "gid://shopify/MediaImage/99", newPosition: 0 }]]);
  assert.equal(liveReadCount, 2);
});

test("media write worker fails verification when replace row keeps wrong alt despite source-only edit", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-replace-alt", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-replace-alt",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Expected alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Expected alt",
                image_position: "1",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-replace-alt",
      payload: {
        previewArtifactId: "preview-artifact-media-replace-alt",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-replace-alt",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-replace-alt",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Expected alt",
              image_position: "1",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Wrong alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/replacement.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Expected alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.equal(result.rows[0].verificationStatus, "failed");
  assert.match(result.rows[0].messages.at(-1), /Final-state verification failed/);
  assert.equal(liveReadCount, 2);
});

test("media write worker preserves original order for replace rows when image_position is blank", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const reorderCalls = [];
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-6", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-6",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "2",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-6",
      payload: {
        previewArtifactId: "preview-artifact-media-6",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-6",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-6",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "2",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Current alt",
            image_position: "2",
            image_src: "https://cdn.shopify.com/replacement.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            reorderCalls.push(variables.moves);
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.deepEqual(reorderCalls, [[{ id: "gid://shopify/MediaImage/99", newPosition: 1 }]]);
  assert.equal(liveReadCount, 2);
});

test("media write worker fails verification when replace row with blank image_position lands in wrong slot", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-7", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-7",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "2",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
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
        };
      },
    },
    job: {
      id: "media-write-job-7",
      payload: {
        previewArtifactId: "preview-artifact-media-7",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-7",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-7",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async (_admin, _productIds, { assertJobLeaseActive } = {}) => {
      assertJobLeaseActive?.();
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "2",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Current alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/replacement.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.equal(result.rows[0].verificationStatus, "failed");
  assert.match(result.rows[0].messages.at(-1), /Final-state verification failed/);
  assert.equal(liveReadCount, 2);
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
  assert.match(result.rows[0].messages[0], /changed after preview confirmation was requested/);
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
