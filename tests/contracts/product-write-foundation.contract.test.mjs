import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRollbackInputFromSnapshotRow,
  buildProductUpdateInputFromPreviewRow,
  buildVariantMutationFromPreviewRow,
  buildVariantPriceMutationFromPreviewRow,
  findLatestRollbackableWriteState,
  findLatestSuccessfulProductWriteArtifact,
  findVerifiedSuccessfulProductWriteArtifactByPreviewJobId,
  getWritablePreviewRows,
  readProjectFile,
} from "./product-write-test-helpers.mjs";

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
  assert.match(result.errors[0], /status の値が不正です/);
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
  assert.match(result.errors[0], /price を変更した場合、空欄にはできません/);
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

test("latest rollbackable write state returns retentionExpired when required artifacts were soft-deleted", async () => {
  const state = await findLatestRollbackableWriteState({
    prisma: {
      artifact: {
        async findMany(args) {
          if (args.where.kind === "product.undo.result") {
            return [];
          }

          if (args.skip > 0) {
            return [];
          }

          return [{
            createdAt: new Date("2026-03-17T00:00:00.000Z"),
            deletedAt: null,
            id: "write-result-1",
            jobId: "write-job-1",
            kind: "product.write.result",
            metadata: {
              outcome: "verified_success",
              profile: "product-core-seo-v1",
              snapshotArtifactId: "write-snapshot-1",
            },
            shopDomain: "example.myshopify.com",
          }];
        },
        async findFirst() {
          return {
            createdAt: new Date("2026-03-17T00:00:00.000Z"),
            deletedAt: new Date("2026-06-16T00:00:00.000Z"),
            id: "write-snapshot-1",
            jobId: "write-job-1",
            kind: "product.write.snapshot",
            metadata: {},
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(state.artifact.id, "write-result-1");
  assert.equal(state.retentionExpired, true);
  assert.equal(state.snapshotArtifact.id, "write-snapshot-1");
});

test("latest rollbackable write state returns retentionExpired once retentionUntil has passed before sweep", async () => {
  const state = await findLatestRollbackableWriteState({
    now: new Date("2026-06-16T00:00:00.000Z"),
    prisma: {
      artifact: {
        async findMany(args) {
          if (args.where.kind === "product.undo.result") {
            return [];
          }

          if (args.skip > 0) {
            return [];
          }

          return [{
            createdAt: new Date("2026-03-17T00:00:00.000Z"),
            deletedAt: null,
            id: "write-result-2",
            jobId: "write-job-2",
            kind: "product.write.result",
            metadata: {
              outcome: "verified_success",
              profile: "product-core-seo-v1",
              snapshotArtifactId: "write-snapshot-2",
            },
            retentionUntil: new Date("2026-06-15T00:00:00.000Z"),
            shopDomain: "example.myshopify.com",
          }];
        },
        async findFirst() {
          return {
            createdAt: new Date("2026-03-17T00:00:00.000Z"),
            deletedAt: null,
            id: "write-snapshot-2",
            jobId: "write-job-2",
            kind: "product.write.snapshot",
            metadata: {},
            retentionUntil: new Date("2026-06-15T00:00:00.000Z"),
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(state.artifact.id, "write-result-2");
  assert.equal(state.retentionExpired, true);
  assert.equal(state.snapshotArtifact.id, "write-snapshot-2");
});

test("latest rollbackable write state keeps snapshot corruption distinct from retention expiry", async () => {
  const state = await findLatestRollbackableWriteState({
    prisma: {
      artifact: {
        async findMany(args) {
          if (args.where.kind === "product.undo.result") {
            return [];
          }

          if (args.skip > 0) {
            return [];
          }

          return [{
            createdAt: new Date("2026-03-17T00:00:00.000Z"),
            deletedAt: null,
            id: "write-result-3",
            jobId: "write-job-3",
            kind: "product.write.result",
            metadata: {
              outcome: "verified_success",
              profile: "product-core-seo-v1",
              snapshotArtifactId: "write-snapshot-3",
            },
            retentionUntil: new Date("2026-06-15T00:00:00.000Z"),
            shopDomain: "example.myshopify.com",
          }];
        },
        async findFirst() {
          return null;
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(state.artifact.id, "write-result-3");
  assert.equal(state.retentionExpired, false);
  assert.equal(state.snapshotArtifact, null);
});

test("verified successful write lookup keeps dedupe active until the prior write artifact is deleted", async () => {
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
              id: "artifact-target",
              jobId: "write-job-a",
              metadata: {
                outcome: "verified_success",
                previewJobId: "preview-job-a",
                profile: "product-core-seo-v1",
              },
              retentionUntil: new Date("2026-06-15T00:00:00.000Z"),
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

test("verified successful write lookup ignores previews whose write was already undone", async () => {
  const artifact = await findVerifiedSuccessfulProductWriteArtifactByPreviewJobId({
    previewJobId: "preview-job-2",
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
          ];
        },
      },
    },
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(artifact, null);
});

test("undo API keeps missing snapshot corruption distinct from retention_expired", () => {
  const service = readProjectFile("app/services/product-writes.server.ts");
  const previewRoute = readProjectFile("app/routes/app.preview.tsx");

  assert.match(service, /code: "retention_expired"/);
  assert.match(service, /const activeUndo = await findActiveProductUndoJob\(/);
  assert.match(service, /if \(activeUndo\) \{\s+return json\(\{\s+jobId: activeUndo\.id,/m);
  assert.match(service, /if \(latestRollbackableWrite\.retentionExpired\) \{\s+return retentionExpiredUndoResponse\(\);/m);
  assert.match(service, /if \(!snapshotArtifact\) \{\s+return json\(\{ error: "取り消しに必要な復元データが見つかりません" \}, \{ status: 400 \}\);/m);
  assert.match(
    service,
    /const activeUndo = await findActiveProductUndoJob[\s\S]*if \(activeUndo\) \{[\s\S]*const latestRollbackableWrite = await readLatestRollbackableWriteOrNull\(shopDomain\);[\s\S]*if \(latestRollbackableWrite\.retentionExpired\) \{\s+return retentionExpiredUndoResponse\(\);/m,
  );
  assert.match(previewRoute, /undoFetcher\.data\?\.code === "retention_expired"/);
  assert.match(previewRoute, /latestWrite\?\.retentionExpired/);
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
