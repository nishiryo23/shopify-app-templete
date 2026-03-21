import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildProductExportArtifacts } from "../../domain/products/export-csv.mjs";
import { createVariantPriceExportCsvBuilder } from "../../domain/variant-prices/export-csv.mjs";
import {
  filterPreviewableExportJobs,
} from "../../domain/products/preview-baselines.mjs";
import {
  buildPreviewDigest,
  buildPreviewRows,
  indexRowsByProductId,
  parseProductPreviewCsv,
} from "../../domain/products/preview-csv.mjs";
import {
  buildVariantPreviewDigest,
  buildVariantPreviewRows,
  parseVariantPreviewCsv,
} from "../../domain/variants/preview-csv.mjs";
import {
  buildVariantPricePreviewDigest,
  buildVariantPricePreviewRows,
  parseVariantPricePreviewCsv,
} from "../../domain/variant-prices/preview-csv.mjs";
import {
  buildActiveProductPreviewWhere,
  enqueueOrFindActiveProductPreviewJob,
} from "../../domain/products/preview-jobs.mjs";
import {
  buildProductPreviewArtifactKey,
  buildProductPreviewDedupeKey,
  PRODUCT_PREVIEW_RESULT_ARTIFACT_KIND,
} from "../../domain/products/preview-profile.mjs";
import { runProductPreviewJob } from "../../workers/product-preview.mjs";
import { MissingOfflineSessionError } from "../../workers/offline-admin.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("preview CSV parser requires exact product-core-seo-v1 headers", () => {
  assert.throws(
    () => parseProductPreviewCsv("product_id,title\n1,Hat\n"),
    /CSV ヘッダーは product-core-seo-v1 と完全一致する必要があります/,
  );
});

test("preview CSV parser preserves row numbers and values", () => {
  const rows = parseProductPreviewCsv(
    "product_id,handle,title,status,vendor,product_type,tags,body_html,seo_title,seo_description,updated_at\n"
    + "gid://shopify/Product/1,hat,Hat,ACTIVE,Matri,Hat,sale,<p>Body</p>,SEO title,SEO description,2026-03-13T00:00:00Z\n",
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[0].row.product_id, "gid://shopify/Product/1");
});

test("variant preview CSV parser requires exact product-variants-v1 headers", () => {
  assert.throws(
    () => parseVariantPreviewCsv("product_id,variant_id\n1,2\n"),
    /CSV ヘッダーは product-variants-v1 と完全一致する必要があります/,
  );
});

test("variant price preview CSV parser requires exact product-variants-prices-v1 headers", () => {
  assert.throws(
    () => parseVariantPricePreviewCsv("product_id,variant_id\n1,2\n"),
    /CSV ヘッダーは product-variants-prices-v1 と完全一致する必要があります/,
  );
});

test("variant preview rejects create rows outside the baseline product set", () => {
  const editedRows = parseVariantPreviewCsv(
    "command,product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,sku,barcode,taxable,requires_shipping,inventory_policy,updated_at\n"
    + "CREATE,gid://shopify/Product/2,,,,Color,Red,,,,SKU-1,,true,true,DENY,\n",
  );
  const { rows, summary } = buildVariantPreviewRows({
    baselineProductIds: new Set(["gid://shopify/Product/1"]),
    baselineRowsByVariantId: new Map(),
    currentProductsById: new Map([
      ["gid://shopify/Product/2", { id: "gid://shopify/Product/2", options: [{ name: "Color", position: 1 }] }],
    ]),
    currentVariantsByProductId: new Map([
      ["gid://shopify/Product/2", []],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages[0], /選択したエクスポート baseline/);
  assert.equal(summary.error, 1);
});

test("variant price preview rejects mismatched product_id for baseline variant", () => {
  const editedRows = parseVariantPricePreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,price,compare_at_price,updated_at\n"
    + "gid://shopify/Product/2,hat,gid://shopify/ProductVariant/1,Color,Red,,,,,10.00,12.00,2026-03-14T00:00:00Z\n",
  );
  const { rows, summary } = buildVariantPricePreviewRows({
    baselineRowsByVariantId: new Map([
      ["gid://shopify/ProductVariant/1", {
        row: {
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
        rowNumber: 2,
      }],
    ]),
    currentVariantsByProductId: new Map([
      ["gid://shopify/Product/2", [{
        compare_at_price: "12.00",
        option1_name: "Color",
        option1_value: "Red",
        option2_name: "",
        option2_value: "",
        option3_name: "",
        option3_value: "",
        price: "10.00",
        product_handle: "hat",
        product_id: "gid://shopify/Product/2",
        updated_at: "2026-03-14T00:00:00Z",
        variant_id: "gid://shopify/ProductVariant/1",
      }]],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages[0], /baseline 上でそのバリエーションを所有する商品/);
  assert.equal(summary.error, 1);
});

test("variant preview rejects create rows with edited option names that do not match the live product schema", () => {
  const editedRows = parseVariantPreviewCsv(
    "command,product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,sku,barcode,taxable,requires_shipping,inventory_policy,updated_at\n"
    + "CREATE,gid://shopify/Product/2,,,,Shade,Red,,,,SKU-1,,true,true,DENY,\n",
  );
  const { rows, summary } = buildVariantPreviewRows({
    baselineProductIds: new Set(["gid://shopify/Product/2"]),
    baselineRowsByVariantId: new Map(),
    currentProductsById: new Map([
      ["gid://shopify/Product/2", { id: "gid://shopify/Product/2", options: [{ name: "Color", position: 1 }] }],
    ]),
    currentVariantsByProductId: new Map([
      ["gid://shopify/Product/2", []],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages[0], /option1_name は Shopify 上の最新の商品オプション名と一致する必要があります/);
  assert.equal(summary.error, 1);
});

test("variant preview digest remains stable for canonical payload", () => {
  const digestA = buildVariantPreviewDigest({
    baselineDigest: "baseline",
    editedDigest: "edited",
    exportJobId: "export-1",
    profile: "product-variants-v1",
    rows: [{
      baselineRow: null,
      changedFields: ["sku"],
      classification: "changed",
      currentRow: null,
      editedRow: { product_id: "1", sku: "A" },
      editedRowNumber: 2,
      operation: "create",
      productId: "1",
      sourceRowNumber: null,
      variantId: null,
    }],
    summary: { total: 1, changed: 1, unchanged: 0, warning: 0, error: 0 },
  });
  const digestB = buildVariantPreviewDigest({
    baselineDigest: "baseline",
    editedDigest: "edited",
    exportJobId: "export-1",
    profile: "product-variants-v1",
    rows: [{
      baselineRow: null,
      changedFields: ["sku"],
      classification: "changed",
      currentRow: null,
      editedRow: { sku: "A", product_id: "1" },
      editedRowNumber: 2,
      operation: "create",
      productId: "1",
      sourceRowNumber: null,
      variantId: null,
    }],
    summary: { error: 0, warning: 0, unchanged: 0, changed: 1, total: 1 },
  });

  assert.equal(digestA, digestB);
});

test("variant price preview digest remains stable for canonical payload", () => {
  const digestA = buildVariantPricePreviewDigest({
    baselineDigest: "baseline",
    editedDigest: "edited",
    exportJobId: "export-1",
    profile: "product-variants-prices-v1",
    rows: [{
      baselineRow: { price: "10.00", compare_at_price: "12.00" },
      changedFields: ["price"],
      classification: "changed",
      currentRow: { price: "10.00", compare_at_price: "12.00" },
      editedRow: {
        compare_at_price: "12.00",
        price: "10",
        product_id: "1",
        variant_id: "2",
      },
      editedRowNumber: 2,
      operation: "update",
      productId: "1",
      sourceRowNumber: 2,
      variantId: "2",
    }],
    summary: { total: 1, changed: 1, unchanged: 0, warning: 0, error: 0 },
  });
  const digestB = buildVariantPricePreviewDigest({
    baselineDigest: "baseline",
    editedDigest: "edited",
    exportJobId: "export-1",
    profile: "product-variants-prices-v1",
    rows: [{
      baselineRow: { compare_at_price: "12.00", price: "10.00" },
      changedFields: ["price"],
      classification: "changed",
      currentRow: { compare_at_price: "12.00", price: "10.00" },
      editedRow: {
        compare_at_price: "12.0",
        price: "10.00",
        product_id: "1",
        variant_id: "2",
      },
      editedRowNumber: 2,
      operation: "update",
      productId: "1",
      sourceRowNumber: 2,
      variantId: "2",
    }],
    summary: { error: 0, warning: 0, unchanged: 0, changed: 1, total: 1 },
  });

  assert.equal(digestA, digestB);
});

test("variant price preview worker builds preview rows from price profile", async () => {
  const sourceBuilder = createVariantPriceExportCsvBuilder({
    signingKey: "test-signing-key",
  });
  const sourceCsv = sourceBuilder.appendVariants([{
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
  }]);
  const { manifest } = sourceBuilder.finalize();

  const result = await runProductPreviewJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get(key) {
        if (key === "edited-artifact") {
          return {
            body: Buffer.from(
              "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,price,compare_at_price,updated_at\n"
              + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/1,Color,Red,,,,,11.00,,2026-03-14T00:00:00Z\n",
            ),
          };
        }
        if (key === "manifest-artifact") {
          return { body: Buffer.from(JSON.stringify(manifest)) };
        }
        return {
          body: Buffer.from(sourceCsv),
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
      id: "preview-job-price-1",
      payload: {
        editedUploadArtifactId: "edited-artifact",
        exportJobId: "export-job-1",
        manifestArtifactId: "manifest-artifact",
        profile: "product-variants-prices-v1",
        sourceArtifactId: "source-artifact",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst({ where }) {
          return {
            id: where.id,
            kind: where.kind,
            objectKey: where.id,
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveVariants: async () => ({
      variantsByProductId: new Map([
        ["gid://shopify/Product/1", [{
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
        }]],
      ]),
    }),
    resolveAdminContext: async () => ({ admin: {} }),
    signingKey: "test-signing-key",
  });

  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.changed, 1);
});

test("variant price preview rejects edited rows that retarget variant_id", () => {
  const editedRows = parseVariantPricePreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,price,compare_at_price,updated_at\n"
    + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/2,Color,Red,,,,,11.00,12.00,2026-03-14T00:00:00Z\n",
  );
  const { rows, summary } = buildVariantPricePreviewRows({
    baselineRowsByVariantId: new Map([
      ["gid://shopify/ProductVariant/1", {
        row: {
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
        rowNumber: 2,
      }],
      ["gid://shopify/ProductVariant/2", {
        row: {
          compare_at_price: "12.00",
          option1_name: "Color",
          option1_value: "Blue",
          option2_name: "",
          option2_value: "",
          option3_name: "",
          option3_value: "",
          price: "10.00",
          product_handle: "hat",
          product_id: "gid://shopify/Product/1",
          updated_at: "2026-03-14T00:00:01Z",
          variant_id: "gid://shopify/ProductVariant/2",
        },
        rowNumber: 3,
      }],
    ]),
    currentVariantsByProductId: new Map([
      ["gid://shopify/Product/1", [{
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
      }, {
        compare_at_price: "12.00",
        option1_name: "Color",
        option1_value: "Blue",
        option2_name: "",
        option2_value: "",
        option3_name: "",
        option3_value: "",
        price: "10.00",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-14T00:00:01Z",
        variant_id: "gid://shopify/ProductVariant/2",
      }]],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages[0], /option1_value は読み取り専用/);
  assert.equal(rows[0].variantId, "gid://shopify/ProductVariant/2");
  assert.equal(summary.error, 1);
});

test("variant price preview matches baseline by variant_id after CSV reorder", () => {
  const editedRows = parseVariantPricePreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,price,compare_at_price,updated_at\n"
    + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/2,Color,Blue,,,,,10.50,12.00,2026-03-14T00:00:01Z\n"
    + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/1,Color,Red,,,,,11.00,12.00,2026-03-14T00:00:00Z\n",
  );
  const { rows, summary } = buildVariantPricePreviewRows({
    baselineRowsByVariantId: new Map([
      ["gid://shopify/ProductVariant/1", {
        row: {
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
        rowNumber: 2,
      }],
      ["gid://shopify/ProductVariant/2", {
        row: {
          compare_at_price: "12.00",
          option1_name: "Color",
          option1_value: "Blue",
          option2_name: "",
          option2_value: "",
          option3_name: "",
          option3_value: "",
          price: "10.00",
          product_handle: "hat",
          product_id: "gid://shopify/Product/1",
          updated_at: "2026-03-14T00:00:01Z",
          variant_id: "gid://shopify/ProductVariant/2",
        },
        rowNumber: 3,
      }],
    ]),
    currentVariantsByProductId: new Map([
      ["gid://shopify/Product/1", [{
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
      }, {
        compare_at_price: "12.00",
        option1_name: "Color",
        option1_value: "Blue",
        option2_name: "",
        option2_value: "",
        option3_name: "",
        option3_value: "",
        price: "10.00",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-14T00:00:01Z",
        variant_id: "gid://shopify/ProductVariant/2",
      }]],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "changed");
  assert.equal(rows[1].classification, "changed");
  assert.deepEqual(rows.map((row) => row.variantId), [
    "gid://shopify/ProductVariant/2",
    "gid://shopify/ProductVariant/1",
  ]);
  assert.equal(summary.changed, 2);
});

test("preview row index rejects duplicate product ids", () => {
  const rows = parseProductPreviewCsv(
    "product_id,handle,title,status,vendor,product_type,tags,body_html,seo_title,seo_description,updated_at\n"
    + "gid://shopify/Product/1,hat,Hat,ACTIVE,Matri,Hat,sale,<p>Body</p>,SEO title,SEO description,2026-03-13T00:00:00Z\n"
    + "gid://shopify/Product/1,hat-2,Hat 2,ACTIVE,Matri,Hat,sale,<p>Body</p>,SEO title,SEO description,2026-03-13T00:00:00Z\n",
  );

  assert.throws(() => indexRowsByProductId(rows), /product_id が重複しています/);
});

test("preview row classification prioritizes warning ahead of changed", () => {
  const baselineRows = indexRowsByProductId(parseProductPreviewCsv(
    "product_id,handle,title,status,vendor,product_type,tags,body_html,seo_title,seo_description,updated_at\n"
    + "gid://shopify/Product/1,hat,Hat,ACTIVE,Matri,Hat,sale,<p>Body</p>,SEO title,SEO description,2026-03-13T00:00:00Z\n",
  ));
  const editedRows = parseProductPreviewCsv(
    "product_id,handle,title,status,vendor,product_type,tags,body_html,seo_title,seo_description,updated_at\n"
    + "gid://shopify/Product/1,hat,Hat edited,ACTIVE,Matri,Hat,sale,<p>Body</p>,SEO title,SEO description,2026-03-13T00:00:00Z\n",
  );
  const currentRowsByProductId = new Map([
    ["gid://shopify/Product/1", {
      body_html: "<p>Body</p>",
      handle: "hat",
      product_id: "gid://shopify/Product/1",
      product_type: "Hat",
      seo_description: "SEO description",
      seo_title: "SEO title",
      status: "ACTIVE",
      tags: "sale",
      title: "Live title changed",
      updated_at: "2026-03-13T00:00:00Z",
      vendor: "Matri",
    }],
  ]);

  const { rows, summary } = buildPreviewRows({
    baselineRowsByProductId: baselineRows,
    currentRowsByProductId,
    editedRows,
  });

  assert.equal(rows[0].classification, "warning");
  assert.equal(summary.warning, 1);
});

test("preview changedFields tracks merchant edits against the baseline export", () => {
  const baselineRows = indexRowsByProductId(parseProductPreviewCsv(
    "product_id,handle,title,status,vendor,product_type,tags,body_html,seo_title,seo_description,updated_at\n"
    + "gid://shopify/Product/1,hat,Title A,ACTIVE,Vendor A,Hat,sale,<p>Body</p>,SEO title,SEO description,2026-03-13T00:00:00Z\n",
  ));
  const editedRows = parseProductPreviewCsv(
    "product_id,handle,title,status,vendor,product_type,tags,body_html,seo_title,seo_description,updated_at\n"
    + "gid://shopify/Product/1,hat,Title A,ACTIVE,Vendor B,Hat,sale,<p>Body</p>,SEO title,SEO description,2026-03-13T00:00:00Z\n",
  );
  const currentRowsByProductId = new Map([
    ["gid://shopify/Product/1", {
      body_html: "<p>Body</p>",
      handle: "hat",
      product_id: "gid://shopify/Product/1",
      product_type: "Hat",
      seo_description: "SEO description",
      seo_title: "SEO title",
      status: "ACTIVE",
      tags: "sale",
      title: "Title B",
      updated_at: "2026-03-14T00:00:00Z",
      vendor: "Vendor A",
    }],
  ]);

  const { rows, summary } = buildPreviewRows({
    baselineRowsByProductId: baselineRows,
    currentRowsByProductId,
    editedRows,
  });

  assert.equal(rows[0].classification, "warning");
  assert.deepEqual(rows[0].changedFields, ["vendor"]);
  assert.equal(summary.warning, 1);
});

test("previewable export filter excludes completed jobs without both baseline artifacts", () => {
  const jobs = [
    { id: "job-1" },
    { id: "job-2" },
    { id: "job-3" },
  ];
  const artifacts = [
    { deletedAt: null, jobId: "job-1", kind: "product.export.source" },
    { deletedAt: null, jobId: "job-1", kind: "product.export.manifest" },
    { deletedAt: null, jobId: "job-2", kind: "product.export.source" },
    { deletedAt: new Date("2026-03-14T00:00:00Z"), jobId: "job-3", kind: "product.export.source" },
    { deletedAt: null, jobId: "job-3", kind: "product.export.manifest" },
  ];

  assert.deepEqual(
    filterPreviewableExportJobs({ artifacts, jobs }).map((job) => job.id),
    ["job-1"],
  );
});

test("preview digest remains stable for canonical payload", () => {
  const digestA = buildPreviewDigest({
    baselineDigest: "baseline",
    editedDigest: "edited",
    exportJobId: "export-1",
    profile: "product-core-seo-v1",
    rows: [{
      baselineRow: { title: "A", product_id: "1" },
      changedFields: ["title"],
      classification: "changed",
      currentRow: { title: "B", product_id: "1" },
      editedRow: { title: "C", product_id: "1" },
      productId: "1",
    }],
    summary: { total: 1, changed: 1, unchanged: 0, warning: 0, error: 0 },
  });
  const digestB = buildPreviewDigest({
    baselineDigest: "baseline",
    editedDigest: "edited",
    exportJobId: "export-1",
    profile: "product-core-seo-v1",
    rows: [{
      baselineRow: { product_id: "1", title: "A" },
      changedFields: ["title"],
      classification: "changed",
      currentRow: { product_id: "1", title: "B" },
      editedRow: { product_id: "1", title: "C" },
      productId: "1",
    }],
    summary: { error: 0, warning: 0, unchanged: 0, changed: 1, total: 1 },
  });

  assert.equal(digestA, digestB);
});

test("preview digest changes when edited row-map identity changes", () => {
  const baseArgs = {
    baselineDigest: "baseline",
    editedDigest: "edited",
    exportJobId: "export-1",
    profile: "product-core-seo-v1",
    rows: [{
      baselineRow: null,
      changedFields: ["title"],
      classification: "changed",
      currentRow: null,
      editedRow: { product_id: "1", title: "Hat Edited" },
      editedRowNumber: 7,
      messages: [],
      productId: "1",
      sourceRowNumber: null,
    }],
    summary: { total: 1, changed: 1, unchanged: 0, warning: 0, error: 0 },
  };
  const digestA = buildPreviewDigest({
    ...baseArgs,
    editedLayout: "matrixify",
    editedRowMapDigest: "row-map-a",
  });
  const digestB = buildPreviewDigest({
    ...baseArgs,
    editedLayout: "matrixify",
    editedRowMapDigest: "row-map-b",
  });

  assert.notEqual(digestA, digestB);
});

test("preview job lookup uses active states only", async () => {
  const calls = [];
  const prisma = {
    job: {
      async findFirst(args) {
        calls.push(args);
        return { id: "job-1", state: "queued" };
      },
    },
  };

  const job = await enqueueOrFindActiveProductPreviewJob({
    editedDigest: "edited",
    editedUploadArtifactId: "artifact-1",
    exportJobId: "export-1",
    jobQueue: { async enqueue() { return null; } },
    manifestArtifactId: "manifest-1",
    prisma,
    profile: "product-core-seo-v1",
    shopDomain: "example.myshopify.com",
    sourceArtifactId: "source-1",
  });

  assert.equal(job.id, "job-1");
  assert.deepEqual(calls[0].where, buildActiveProductPreviewWhere({
    editedDigest: "edited",
    exportJobId: "export-1",
    shopDomain: "example.myshopify.com",
  }));
});

test("preview profile builds stable artifact keys and dedupe keys", () => {
  assert.equal(
    buildProductPreviewArtifactKey({
      fileName: "result.json",
      jobId: "job-1",
      prefix: "resolved-prefix",
      shopDomain: "example.myshopify.com",
    }),
    "resolved-prefix/product-previews/example.myshopify.com/job-1/result.json",
  );
  assert.equal(
    buildProductPreviewDedupeKey({
      editedDigest: "edited",
      editedLayout: "canonical",
      editedRowMapDigest: "none",
      exportJobId: "export-1",
    }),
    "product-preview:export-1:canonical:edited:none",
  );
});

test("product preview worker stores result artifact on success", async () => {
  const { csvText, manifest } = buildProductExportArtifacts({
    products: [{
      descriptionHtml: "<p>Body</p>",
      handle: "hat",
      id: "gid://shopify/Product/1",
      productType: "Hat",
      seo: { description: "SEO description", title: "SEO title" },
      status: "ACTIVE",
      tags: ["sale"],
      title: "Hat",
      updatedAt: "2026-03-13T00:00:00Z",
      vendor: "Matri",
    }],
    signingKey: "test-signing-key",
  });
  const editedCsv = csvText.replace("Hat", "Hat Edited");
  const puts = [];
  const records = [];

  const result = await runProductPreviewJob({
    artifactCatalog: {
      async record(args) {
        records.push(args);
        return { id: `artifact-${records.length}`, ...args };
      },
    },
    artifactKeyPrefix: "resolved-prefix",
    artifactStorage: {
      async get(key) {
        if (key.includes("edited.csv")) {
          return Buffer.from(editedCsv);
        }
        if (key.includes("manifest.json")) {
          return Buffer.from(JSON.stringify(manifest));
        }
        return Buffer.from(csvText);
      },
      async put(args) {
        puts.push(args);
        return {
          bucket: "artifacts",
          checksumSha256: "sha-result",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
          sizeBytes: Buffer.byteLength(args.body),
          visibility: "private",
        };
      },
    },
    job: {
      id: "job-1",
      payload: {
        editedDigest: "edited",
        editedUploadArtifactId: "edited-artifact",
        exportJobId: "export-1",
        manifestArtifactId: "manifest-artifact",
        profile: "product-core-seo-v1",
        sourceArtifactId: "source-artifact",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst({ where }) {
          if (where.id === "edited-artifact") {
            return {
              id: "edited-artifact",
              kind: "product.preview.edited-upload",
              objectKey: "product-previews/example.myshopify.com/upload/edited.csv",
              shopDomain: "example.myshopify.com",
            };
          }
          if (where.id === "manifest-artifact") {
            return {
              id: "manifest-artifact",
              kind: "product.export.manifest",
              objectKey: "product-exports/example.myshopify.com/export-1/manifest.json",
              shopDomain: "example.myshopify.com",
            };
          }
          return {
            id: "source-artifact",
            kind: "product.export.source",
            objectKey: "product-exports/example.myshopify.com/export-1/source.csv",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveProducts: async () => new Map([
      ["gid://shopify/Product/1", {
        body_html: "<p>Body</p>",
        handle: "hat",
        product_id: "gid://shopify/Product/1",
        product_type: "Hat",
        seo_description: "SEO description",
        seo_title: "SEO title",
        status: "ACTIVE",
        tags: "sale",
        title: "Hat",
        updated_at: "2026-03-13T00:00:00Z",
        vendor: "Matri",
      }],
    ]),
    resolveAdminContext: async () => ({ admin: {} }),
    signingKey: "test-signing-key",
  });

  assert.equal(result.summary.changed, 1);
  assert.equal(puts[0].key, "resolved-prefix/product-previews/example.myshopify.com/job-1/result.json");
  assert.equal(records[0].kind, PRODUCT_PREVIEW_RESULT_ARTIFACT_KIND);
});

test("product preview worker uses the live handle for redirect lookup and preview metadata", async () => {
  const { csvText, manifest } = buildProductExportArtifacts({
    products: [{
      descriptionHtml: "<p>Body</p>",
      handle: "hat-old",
      id: "gid://shopify/Product/1",
      productType: "Hat",
      seo: { description: "SEO description", title: "SEO title" },
      status: "ACTIVE",
      tags: ["sale"],
      title: "Hat",
      updatedAt: "2026-03-13T00:00:00Z",
      vendor: "Matri",
    }],
    signingKey: "test-signing-key",
  });
  const editedCsv = csvText.replace("hat-old", "hat-new");
  const puts = [];
  const redirectReads = [];

  const result = await runProductPreviewJob({
    artifactCatalog: {
      async record(args) {
        return { id: `artifact-${args.kind}`, ...args };
      },
    },
    artifactKeyPrefix: "resolved-prefix",
    artifactStorage: {
      async get(key) {
        if (key.includes("edited.csv")) {
          return Buffer.from(editedCsv);
        }
        if (key.includes("manifest.json")) {
          return Buffer.from(JSON.stringify(manifest));
        }
        return Buffer.from(csvText);
      },
      async put(args) {
        puts.push(args);
        return {
          bucket: "artifacts",
          checksumSha256: "sha-result",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
          sizeBytes: Buffer.byteLength(args.body),
          visibility: "private",
        };
      },
    },
    job: {
      id: "job-live-handle-preview",
      payload: {
        editedDigest: "edited",
        editedUploadArtifactId: "edited-artifact",
        exportJobId: "export-1",
        manifestArtifactId: "manifest-artifact",
        profile: "product-core-seo-v1",
        sourceArtifactId: "source-artifact",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst({ where }) {
          if (where.id === "edited-artifact") {
            return {
              id: "edited-artifact",
              kind: "product.preview.edited-upload",
              objectKey: "product-previews/example.myshopify.com/upload/edited.csv",
              shopDomain: "example.myshopify.com",
            };
          }
          if (where.id === "manifest-artifact") {
            return {
              id: "manifest-artifact",
              kind: "product.export.manifest",
              objectKey: "product-exports/example.myshopify.com/export-1/manifest.json",
              shopDomain: "example.myshopify.com",
            };
          }
          return {
            id: "source-artifact",
            kind: "product.export.source",
            objectKey: "product-exports/example.myshopify.com/export-1/source.csv",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveProducts: async () => new Map([
      ["gid://shopify/Product/1", {
        body_html: "<p>Body</p>",
        handle: "hat-live",
        product_id: "gid://shopify/Product/1",
        product_type: "Hat",
        seo_description: "SEO description",
        seo_title: "SEO title",
        status: "ACTIVE",
        tags: "sale",
        title: "Hat",
        updated_at: "2026-03-13T00:00:00Z",
        vendor: "Matri",
      }],
    ]),
    readLiveRedirects: async (_admin, paths) => {
      redirectReads.push(paths);
      return new Map([["/products/hat-live", [{
        id: "gid://shopify/UrlRedirect/1",
        path: "/products/hat-live",
        target: "/products/hat-new",
      }]]]);
    },
    resolveAdminContext: async () => ({ admin: {} }),
    signingKey: "test-signing-key",
  });

  const payload = JSON.parse(String(puts[0].body));
  assert.deepEqual(redirectReads, [["/products/hat-live"]]);
  assert.equal(result.summary.error, 1);
  assert.equal(payload.rows[0].classification, "error");
  assert.equal(payload.rows[0].previousHandle, "hat-live");
  assert.equal(payload.rows[0].redirectPath, "/products/hat-live");
  assert.equal(payload.rows[0].redirectTarget, "/products/hat-new");
});

test("product preview worker compensates storage when result catalog record fails", async () => {
  const { csvText, manifest } = buildProductExportArtifacts({
    products: [{
      descriptionHtml: "<p>Body</p>",
      handle: "hat",
      id: "gid://shopify/Product/1",
      productType: "Hat",
      seo: { description: "SEO description", title: "SEO title" },
      status: "ACTIVE",
      tags: ["sale"],
      title: "Hat",
      updatedAt: "2026-03-13T00:00:00Z",
      vendor: "Matri",
    }],
    signingKey: "test-signing-key",
  });
  const deletedKeys = [];

  await assert.rejects(
    () => runProductPreviewJob({
      artifactCatalog: {
        async markDeleted() {
          return true;
        },
        async record() {
          throw new Error("catalog failed");
        },
      },
      artifactKeyPrefix: "resolved-prefix",
      artifactStorage: {
        async delete(key) {
          deletedKeys.push(key.objectKey);
          return true;
        },
        async get(key) {
          if (key.includes("edited.csv")) {
            return Buffer.from(csvText.replace("Hat", "Hat Edited"));
          }
          if (key.includes("manifest.json")) {
            return Buffer.from(JSON.stringify(manifest));
          }
          return Buffer.from(csvText);
        },
        async put(args) {
          return {
            bucket: "artifacts",
            checksumSha256: "sha-result",
            contentType: args.contentType,
            metadata: args.metadata,
            objectKey: args.key,
            sizeBytes: Buffer.byteLength(args.body),
            visibility: "private",
          };
        },
      },
      job: {
        id: "job-1",
        payload: {
          editedDigest: "edited",
          editedUploadArtifactId: "edited-artifact",
          exportJobId: "export-1",
          manifestArtifactId: "manifest-artifact",
          profile: "product-core-seo-v1",
          sourceArtifactId: "source-artifact",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst({ where }) {
            if (where.id === "edited-artifact") {
              return {
                id: "edited-artifact",
                kind: "product.preview.edited-upload",
                objectKey: "product-previews/example.myshopify.com/upload/edited.csv",
                shopDomain: "example.myshopify.com",
              };
            }
            if (where.id === "manifest-artifact") {
              return {
                id: "manifest-artifact",
                kind: "product.export.manifest",
                objectKey: "product-exports/example.myshopify.com/export-1/manifest.json",
                shopDomain: "example.myshopify.com",
              };
            }
            return {
              id: "source-artifact",
              kind: "product.export.source",
              objectKey: "product-exports/example.myshopify.com/export-1/source.csv",
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
      readLiveProducts: async () => new Map([
        ["gid://shopify/Product/1", {
          body_html: "<p>Body</p>",
          handle: "hat",
          product_id: "gid://shopify/Product/1",
          product_type: "Hat",
          seo_description: "SEO description",
          seo_title: "SEO title",
          status: "ACTIVE",
          tags: "sale",
          title: "Hat",
          updated_at: "2026-03-13T00:00:00Z",
          vendor: "Matri",
        }],
      ]),
      resolveAdminContext: async () => ({ admin: {} }),
      signingKey: "test-signing-key",
    }),
    /catalog failed/,
  );

  assert.deepEqual(
    deletedKeys,
    ["resolved-prefix/product-previews/example.myshopify.com/job-1/result.json"],
  );
});

test("product preview worker marks missing offline session with stable error code", async () => {
  const { csvText, manifest } = buildProductExportArtifacts({
    products: [{
      descriptionHtml: "<p>Body</p>",
      handle: "hat",
      id: "gid://shopify/Product/1",
      productType: "Hat",
      seo: { description: "SEO description", title: "SEO title" },
      status: "ACTIVE",
      tags: ["sale"],
      title: "Hat",
      updatedAt: "2026-03-13T00:00:00Z",
      vendor: "Matri",
    }],
    signingKey: "test-signing-key",
  });
  let capturedError = null;

  await assert.rejects(
    async () => runProductPreviewJob({
      artifactCatalog: {
        async record() {
          throw new Error("should not record");
        },
      },
      artifactStorage: {
        async get(key) {
          if (key === "edited-artifact") {
            return Buffer.from(csvText);
          }
          if (key === "manifest-artifact") {
            return Buffer.from(JSON.stringify(manifest));
          }
          return Buffer.from(csvText);
        },
        async put() {
          throw new Error("should not write");
        },
      },
      job: {
        id: "job-1",
        payload: {
          editedUploadArtifactId: "edited-artifact",
          manifestArtifactId: "manifest-artifact",
          sourceArtifactId: "source-artifact",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst({ where }) {
            return {
              id: where.id,
              kind: where.kind,
              objectKey: where.id,
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
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

test("preview plan and ADR capture route truth and edited upload semantics", () => {
  const plan = readProjectFile("plans/PD-012-matrixify-compatibility-subset.md");
  const adr = readProjectFile("adr/0009-product-preview-route-and-provenance-contract.md");

  assert.match(plan, /Matrixify subset/);
  assert.match(plan, /editedRowMapDigest/);
  assert.match(adr, /editedLayout=matrixify/);
  assert.match(adr, /editedRowMapDigest/);
  assert.match(adr, /missing-offline-session/);
});

test("preview route and page delegate to the shared services", () => {
  const routeFile = readProjectFile("app/routes/app.product-previews.ts");
  const pageFile = readProjectFile("app/routes/app.preview.tsx");
  const copyFile = readProjectFile("app/utils/admin-copy.ts");
  const workerBootstrap = readProjectFile("workers/bootstrap.mjs");

  assert.match(routeFile, /createProductPreview/);
  assert.match(pageFile, /loadProductPreviewPage/);
  assert.match(pageFile, /preview-shell/);
  assert.match(pageFile, /PRODUCT_PROFILE_OPTIONS/);
  assert.match(copyFile, /product-variants-prices-v1/);
  assert.match(pageFile, /useSearchParams/);
  assert.match(pageFile, /編集レイアウト/);
  assert.match(pageFile, /Matrixify 互換モード/);
  assert.match(pageFile, /リクエストエラー:/);
  assert.match(workerBootstrap, /PRODUCT_PREVIEW_KIND/);
});

test("completed exports are paged until enough profile-matching baselines are found", () => {
  const serviceFile = readProjectFile("app/services/product-previews.server.ts");

  assert.match(serviceFile, /while \(matchingJobs\.length < 20\)/);
  assert.match(serviceFile, /skip \+= jobs\.length/);
  assert.match(serviceFile, /matchingJobs\.push\(\.\.\.jobs\.filter/);
  assert.match(serviceFile, /filterPreviewableExportJobs\(\{ artifacts, jobs: matchingJobs \}\)\.slice\(0, 20\)/);
});

test("preview page keeps reloading until a newly started export appears in the baseline list", () => {
  const pageFile = readProjectFile("app/routes/app.preview.tsx");

  assert.match(pageFile, /const loadedExports = selectedLoaderData\?\.exports \?\? \[\]/);
  assert.match(pageFile, /const activeExportJobId = exportFetcher\.data\?\.profile === selectedProfile/);
  assert.match(pageFile, /const exportVisible = !activeExportJobId \|\| loadedExports\.some\(\(job\) => job\.id === activeExportJobId\)/);
  assert.match(pageFile, /if \(!activeExportJobId && !activePreviewJobId && !activeWriteJobId && !activeUndoJobId\)/);
  assert.match(pageFile, /if \(loadedExports\.some\(\(job\) => job\.id === selectedExportJobId\)\)/);
  assert.match(pageFile, /\{loadedExports\.map\(\(job\) => \(/);
});
