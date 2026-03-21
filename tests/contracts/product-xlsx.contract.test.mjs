import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

import {
  buildCollectionPreviewRows,
  parseCollectionPreviewCsv,
} from "../../domain/collections/preview-csv.mjs";
import {
  buildMediaPreviewRows,
  indexMediaRows,
  parseMediaPreviewCsv,
} from "../../domain/media/preview-csv.mjs";
import {
  buildMetafieldPreviewRows,
  parseMetafieldPreviewCsv,
} from "../../domain/metafields/preview-csv.mjs";
import { buildProductExportArtifacts } from "../../domain/products/export-csv.mjs";
import {
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_EXPORT_FORMAT,
  PRODUCT_EXPORT_XLSX_FORMAT,
  PRODUCT_EXPORT_PROFILES,
  PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE,
  PRODUCT_MEDIA_EXPORT_PROFILE,
  PRODUCT_METAFIELDS_EXPORT_PROFILE,
  PRODUCT_VARIANTS_EXPORT_PROFILE,
} from "../../domain/products/export-profile.mjs";
import {
  buildProductSourceBufferFromCanonicalCsv,
  canonicalizeProductSpreadsheet,
  getProductExportHeaders,
  PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
  resolveProductSpreadsheetFormatFromFileName,
} from "../../domain/products/spreadsheet-format.mjs";
import {
  buildVariantPreviewRows,
  parseVariantPreviewCsv,
} from "../../domain/variants/preview-csv.mjs";
import { parseCsvRows, parseCsvRowsFromStream, serializeCsvRows } from "../../domain/spreadsheets/csv.mjs";
import { enqueueProductExportJob } from "../../domain/products/export-jobs.mjs";
import { runProductExportJob } from "../../workers/product-export.mjs";
import { runProductPreviewJob } from "../../workers/product-preview.mjs";

test("xlsx round-trip preserves canonical rows for all launch profiles", async () => {
  for (const profile of PRODUCT_EXPORT_PROFILES) {
    const headers = getProductExportHeaders(profile);
    const rows = [
      headers,
      headers.map((header, index) => `${profile}-${header}-${index}`),
    ];
    const workbookBody = await buildProductSourceBufferFromCanonicalCsv({
      canonicalCsvText: serializeCsvRows(rows),
      format: PRODUCT_EXPORT_XLSX_FORMAT,
      profile,
    });

    const result = await canonicalizeProductSpreadsheet({
      body: workbookBody,
      format: PRODUCT_EXPORT_XLSX_FORMAT,
      profile,
    });

    assert.equal(result.canonicalCsvText, serializeCsvRows(rows));
    assert.equal(result.rowCount, 1);
  }
});

test("matrixify csv subset canonicalizes product core rows with baseline backfill", async () => {
  const { csvText } = buildProductExportArtifacts({
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

  const result = await canonicalizeProductSpreadsheet({
    baselineCanonicalCsvText: csvText,
    body: Buffer.from("ID,Title\n\"gid://shopify/Product/1\",Hat Edited\n", "utf8"),
    format: PRODUCT_EXPORT_FORMAT,
    layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
    profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
  });
  const rows = parseCsvRows(result.canonicalCsvText);

  assert.equal(rows[1][0], "gid://shopify/Product/1");
  assert.equal(rows[1][1], "hat");
  assert.equal(rows[1][2], "Hat Edited");
  assert.equal(rows[1][4], "Matri");
  assert.equal(rows[1][10], "2026-03-13T00:00:00Z");
  assert.deepEqual(result.editedRowNumbers, [2]);
  assert.match(result.editedRowMapDigest, /^[a-f0-9]{64}$/);
});

test("matrixify csv subset preserves option names for variant CREATE preview rows", async () => {
  const baselineCsv = [
    "command,product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,sku,barcode,taxable,requires_shipping,inventory_policy,updated_at",
    ",gid://shopify/Product/1,hat,gid://shopify/ProductVariant/1,Size,M,,,,,SKU-1,,true,true,DENY,2026-03-13T00:00:00Z",
  ].join("\n");

  const result = await canonicalizeProductSpreadsheet({
    baselineCanonicalCsvText: baselineCsv,
    body: Buffer.from("ID,Option1 Name,Option1 Value,Command\n\"gid://shopify/Product/1\",Size,L,CREATE\n", "utf8"),
    format: PRODUCT_EXPORT_FORMAT,
    layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
    profile: PRODUCT_VARIANTS_EXPORT_PROFILE,
  });

  const preview = buildVariantPreviewRows({
    baselineProductIds: new Set(["gid://shopify/Product/1"]),
    baselineRowsByVariantId: new Map(),
    currentProductsById: new Map([
      ["gid://shopify/Product/1", {
        id: "gid://shopify/Product/1",
        options: [{ name: "Size", position: 1 }],
      }],
    ]),
    currentVariantsByProductId: new Map([["gid://shopify/Product/1", []]]),
    editedRows: parseVariantPreviewCsv(result.canonicalCsvText),
  });

  assert.equal(preview.rows[0].classification, "changed");
  assert.equal(preview.rows[0].operation, "create");
  assert.equal(preview.rows[0].editedRow.option1_name, "Size");
});

test("matrixify csv subset preserves variant DELETE commands", async () => {
  const baselineCsv = [
    "command,product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,sku,barcode,taxable,requires_shipping,inventory_policy,updated_at",
    ",gid://shopify/Product/1,hat,gid://shopify/ProductVariant/1,Size,M,,,,,SKU-1,,true,true,DENY,2026-03-13T00:00:00Z",
  ].join("\n");

  const result = await canonicalizeProductSpreadsheet({
    baselineCanonicalCsvText: baselineCsv,
    body: Buffer.from("ID,Variant ID,Command\n\"gid://shopify/Product/1\",\"gid://shopify/ProductVariant/1\",DELETE\n", "utf8"),
    format: PRODUCT_EXPORT_FORMAT,
    layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
    profile: PRODUCT_VARIANTS_EXPORT_PROFILE,
  });

  const preview = buildVariantPreviewRows({
    baselineProductIds: new Set(["gid://shopify/Product/1"]),
    baselineRowsByVariantId: new Map([["gid://shopify/ProductVariant/1", parseVariantPreviewCsv(baselineCsv)[0]]]),
    currentProductsById: new Map([
      ["gid://shopify/Product/1", {
        id: "gid://shopify/Product/1",
        options: [{ name: "Size", position: 1 }],
      }],
    ]),
    currentVariantsByProductId: new Map([["gid://shopify/Product/1", [parseVariantPreviewCsv(baselineCsv)[0].row]]]),
    editedRows: parseVariantPreviewCsv(result.canonicalCsvText),
  });

  assert.equal(preview.rows[0].classification, "changed");
  assert.equal(preview.rows[0].operation, "delete");
  assert.equal(preview.rows[0].editedRow.command, "DELETE");
  assert.equal(preview.rows[0].editedRow.product_handle, "hat");
});

test("matrixify csv subset maps existing media rows to update instead of create", async () => {
  const baselineCsv = [
    "product_id,product_handle,media_id,media_content_type,image_src,image_alt,image_position,updated_at",
    "gid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://cdn.example.com/hat.jpg,Old alt,1,2026-03-13T00:00:00Z",
  ].join("\n");

  const result = await canonicalizeProductSpreadsheet({
    baselineCanonicalCsvText: baselineCsv,
    body: Buffer.from("ID,Image Src,Image Alt Text\n\"gid://shopify/Product/1\",https://cdn.example.com/hat.jpg,New alt\n", "utf8"),
    format: PRODUCT_EXPORT_FORMAT,
    layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
    profile: PRODUCT_MEDIA_EXPORT_PROFILE,
  });
  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const baselineIndex = indexMediaRows(baselineRows);
  const preview = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId: baselineIndex.placeholderRowsByProductId,
    baselineProductIds: baselineIndex.productIds,
    baselineRowsByKey: baselineIndex.rowsByKey,
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
        image_alt: "Old alt",
        image_position: "1",
        image_src: "https://cdn.example.com/hat.jpg",
        media_content_type: "IMAGE",
        media_id: "gid://shopify/MediaImage/1",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-13T00:00:00Z",
      }],
    ]),
    editedRows: parseMediaPreviewCsv(result.canonicalCsvText),
  });

  assert.equal(preview.rows[0].classification, "changed");
  assert.equal(preview.rows[0].operation, "update");
  assert.equal(preview.rows[0].mediaId, "gid://shopify/MediaImage/1");
  assert.deepEqual(preview.rows[0].changedFields, ["image_alt"]);
});

test("matrixify csv subset rejects ambiguous updates to existing media rows", async () => {
  const baselineCsv = [
    "product_id,product_handle,media_id,media_content_type,image_src,image_alt,image_position,updated_at",
    "gid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://cdn.example.com/hat.jpg,Old alt,1,2026-03-13T00:00:00Z",
  ].join("\n");

  await assert.rejects(
    () => canonicalizeProductSpreadsheet({
      baselineCanonicalCsvText: baselineCsv,
      body: Buffer.from("ID,Image Src,Image Position\n\"gid://shopify/Product/1\",https://cdn.example.com/hat-new.jpg,2\n", "utf8"),
      format: PRODUCT_EXPORT_FORMAT,
      layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
      profile: PRODUCT_MEDIA_EXPORT_PROFILE,
    }),
    /既存メディアへの曖昧な更新は未対応です/,
  );
});

test("matrixify csv subset backfills existing manual collection metadata", async () => {
  const baselineCsv = [
    "product_id,product_handle,collection_id,collection_handle,collection_title,membership,updated_at",
    "gid://shopify/Product/1,hat,gid://shopify/Collection/1,sale,Sale,member,2026-03-13T00:00:00Z",
  ].join("\n");

  const result = await canonicalizeProductSpreadsheet({
    baselineCanonicalCsvText: baselineCsv,
    body: Buffer.from("ID,Handle,Custom Collections\n\"gid://shopify/Product/1\",hat,sale\n", "utf8"),
    format: PRODUCT_EXPORT_FORMAT,
    layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
    profile: PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE,
  });

  const preview = buildCollectionPreviewRows({
    baselineRows: parseCollectionPreviewCsv(baselineCsv),
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001egid://shopify/Collection/1", {
        collection_handle: "sale",
        collection_id: "gid://shopify/Collection/1",
        collection_title: "Sale",
        membership: "member",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-13T00:00:00Z",
      }],
    ]),
    editedRows: parseCollectionPreviewCsv(result.canonicalCsvText),
    existingProductIds: new Set(["gid://shopify/Product/1"]),
    productRowsById: new Map([["gid://shopify/Product/1", { product_handle: "hat" }]]),
    resolvedCollectionsByHandle: new Map([["sale", {
      handle: "sale",
      id: "gid://shopify/Collection/1",
      ruleSet: null,
      title: "Sale",
    }]]),
    resolvedCollectionsById: new Map([["gid://shopify/Collection/1", {
      handle: "sale",
      id: "gid://shopify/Collection/1",
      ruleSet: null,
      title: "Sale",
    }]]),
  });

  assert.equal(preview.rows[0].classification, "unchanged");
  assert.equal(preview.rows[0].messages.length, 0);
  assert.equal(preview.rows[0].editedRow.collection_id, "gid://shopify/Collection/1");
  assert.equal(preview.rows[0].editedRow.collection_title, "Sale");
});

test("matrixify csv subset keeps blank custom collections as noop for products without baseline memberships", async () => {
  const baselineCsv = [
    "product_id,product_handle,collection_id,collection_handle,collection_title,membership,updated_at",
    "gid://shopify/Product/1,hat,,,,,",
  ].join("\n");

  const result = await canonicalizeProductSpreadsheet({
    baselineCanonicalCsvText: baselineCsv,
    body: Buffer.from("ID,Handle,Custom Collections\n\"gid://shopify/Product/1\",hat,\n", "utf8"),
    format: PRODUCT_EXPORT_FORMAT,
    layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
    profile: PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE,
  });

  const preview = buildCollectionPreviewRows({
    baselineRows: parseCollectionPreviewCsv(baselineCsv),
    currentRowsByKey: new Map(),
    editedRows: parseCollectionPreviewCsv(result.canonicalCsvText),
    existingProductIds: new Set(["gid://shopify/Product/1"]),
    productRowsById: new Map([["gid://shopify/Product/1", { product_handle: "hat" }]]),
    resolvedCollectionsByHandle: new Map(),
    resolvedCollectionsById: new Map(),
  });

  assert.equal(preview.rows[0].classification, "unchanged");
  assert.equal(preview.rows[0].messages.length, 0);
});

test("matrixify csv subset rejects omitted baseline manual collections", async () => {
  const baselineCsv = [
    "product_id,product_handle,collection_id,collection_handle,collection_title,membership,updated_at",
    "gid://shopify/Product/1,hat,gid://shopify/Collection/1,sale,Sale,member,2026-03-13T00:00:00Z",
    "gid://shopify/Product/1,hat,gid://shopify/Collection/2,summer,Summer,member,2026-03-13T00:00:00Z",
  ].join("\n");

  await assert.rejects(
    () => canonicalizeProductSpreadsheet({
      baselineCanonicalCsvText: baselineCsv,
      body: Buffer.from("ID,Handle,Custom Collections\n\"gid://shopify/Product/1\",hat,sale\n", "utf8"),
      format: PRODUCT_EXPORT_FORMAT,
      layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
      profile: PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE,
    }),
    /remove セマンティクスは未対応です/,
  );
});

test("matrixify csv subset rejects blank media source cells", async () => {
  const baselineCsv = [
    "product_id,product_handle,media_id,media_content_type,image_src,image_alt,image_position,updated_at",
    "gid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://cdn.example.com/hat.jpg,Old alt,1,2026-03-13T00:00:00Z",
  ].join("\n");

  await assert.rejects(
    () => canonicalizeProductSpreadsheet({
      baselineCanonicalCsvText: baselineCsv,
      body: Buffer.from("ID,Image Src,Image Position\n\"gid://shopify/Product/1\",,1\n", "utf8"),
      format: PRODUCT_EXPORT_FORMAT,
      layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
      profile: PRODUCT_MEDIA_EXPORT_PROFILE,
    }),
    /Matrixify のメディア 2 行目には Image Src が必要です。削除セマンティクスは未対応です/,
  );
});

test("matrixify csv subset backfills owner handle for metafield CREATE preview rows", async () => {
  const baselineCsv = [
    "product_id,product_handle,namespace,key,type,value,updated_at",
    "gid://shopify/Product/1,hat,seo,title_tag,single_line_text_field,SEO title,2026-03-13T00:00:00Z",
  ].join("\n");

  const result = await canonicalizeProductSpreadsheet({
    baselineCanonicalCsvText: baselineCsv,
    body: Buffer.from("Owner ID,Namespace,Key,Type,Value\n\"gid://shopify/Product/1\",custom,material,single_line_text_field,Cotton\n", "utf8"),
    format: PRODUCT_EXPORT_FORMAT,
    layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
    profile: PRODUCT_METAFIELDS_EXPORT_PROFILE,
  });

  const preview = buildMetafieldPreviewRows({
    baselineRowsByKey: new Map(),
    currentRowsByKey: new Map(),
    existingProductIds: new Set(["gid://shopify/Product/1"]),
    productRowsById: new Map([
      ["gid://shopify/Product/1", {
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "",
      }],
    ]),
    editedRows: parseMetafieldPreviewCsv(result.canonicalCsvText),
  });

  assert.equal(preview.rows[0].classification, "changed");
  assert.equal(preview.rows[0].operation, "create");
  assert.equal(preview.rows[0].editedRow.product_handle, "hat");
});

test("spreadsheet format inference rejects unknown file extensions", () => {
  assert.equal(resolveProductSpreadsheetFormatFromFileName("edited.csv"), PRODUCT_EXPORT_FORMAT);
  assert.equal(resolveProductSpreadsheetFormatFromFileName("edited.xlsx"), PRODUCT_EXPORT_XLSX_FORMAT);
  assert.equal(resolveProductSpreadsheetFormatFromFileName("edited.txt"), null);
  assert.equal(resolveProductSpreadsheetFormatFromFileName("edited"), null);
});

test("matrixify xlsx subset requires the Matrixify worksheet name", async () => {
  const { csvText } = buildProductExportArtifacts({
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
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Wrong Sheet");
  worksheet.getCell(1, 1).value = "ID";
  worksheet.getCell(1, 2).value = "Title";
  worksheet.getCell(2, 1).value = "gid://shopify/Product/1";
  worksheet.getCell(2, 2).value = "Hat Edited";
  const body = Buffer.from(await workbook.xlsx.writeBuffer());

  await assert.rejects(
    () => canonicalizeProductSpreadsheet({
      baselineCanonicalCsvText: csvText,
      body,
      format: PRODUCT_EXPORT_XLSX_FORMAT,
      layout: PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
      profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
    }),
    /XLSX ワークシート名は Products と完全一致する必要があります/,
  );
});

test("xlsx canonicalization rejects extra worksheets", async () => {
  const workbook = new ExcelJS.Workbook();
  const headers = getProductExportHeaders(PRODUCT_CORE_SEO_EXPORT_PROFILE);
  const worksheet = workbook.addWorksheet(PRODUCT_CORE_SEO_EXPORT_PROFILE);
  headers.forEach((header, index) => {
    worksheet.getCell(1, index + 1).value = header;
    worksheet.getCell(2, index + 1).value = `value-${index}`;
  });
  workbook.addWorksheet("extra-sheet");

  const body = Buffer.from(await workbook.xlsx.writeBuffer());

  await assert.rejects(
    () => canonicalizeProductSpreadsheet({
      body,
      format: PRODUCT_EXPORT_XLSX_FORMAT,
      profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
    }),
    /product-core-seo-v1 という名前のワークシートが 1 つだけ必要です/,
  );
});

test("xlsx canonicalization rejects non-text and formula cells", async () => {
  const workbook = new ExcelJS.Workbook();
  const headers = getProductExportHeaders(PRODUCT_CORE_SEO_EXPORT_PROFILE);
  const worksheet = workbook.addWorksheet(PRODUCT_CORE_SEO_EXPORT_PROFILE);
  headers.forEach((header, index) => {
    worksheet.getCell(1, index + 1).value = header;
    worksheet.getCell(1, index + 1).numFmt = "@";
  });
  worksheet.getCell(2, 1).value = "gid://shopify/Product/1";
  worksheet.getCell(2, 2).value = 123;
  worksheet.getCell(2, 3).value = { formula: "1+1" };

  const body = Buffer.from(await workbook.xlsx.writeBuffer());

  await assert.rejects(
    () => canonicalizeProductSpreadsheet({
      body,
      format: PRODUCT_EXPORT_XLSX_FORMAT,
      profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
    }),
    /数値ではなくテキストである必要があります|数式を含められません/,
  );
});

test("xlsx canonicalization rejects sparse extra columns", async () => {
  const workbook = new ExcelJS.Workbook();
  const headers = getProductExportHeaders(PRODUCT_CORE_SEO_EXPORT_PROFILE);
  const worksheet = workbook.addWorksheet(PRODUCT_CORE_SEO_EXPORT_PROFILE);
  headers.forEach((header, index) => {
    worksheet.getCell(1, index + 1).value = header;
    worksheet.getCell(2, index + 1).value = `value-${index}`;
  });
  worksheet.getCell(1, headers.length + 5).value = "unexpected-header";
  worksheet.getCell(2, headers.length + 5).value = "unexpected-extra-column";

  const body = Buffer.from(await workbook.xlsx.writeBuffer());

  await assert.rejects(
    () => canonicalizeProductSpreadsheet({
      body,
      format: PRODUCT_EXPORT_XLSX_FORMAT,
      profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
    }),
    /未対応の余分な列があります/,
  );
});

test("product export enqueue supports xlsx format in dedupe key", async () => {
  const calls = [];
  const jobQueue = {
    async enqueue(args) {
      calls.push(args);
      return { id: "job-xlsx", state: "queued", ...args };
    },
  };

  const job = await enqueueProductExportJob({
    format: PRODUCT_EXPORT_XLSX_FORMAT,
    jobQueue,
    profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
    shopDomain: "example.myshopify.com",
  });

  assert.equal(job.payload.format, PRODUCT_EXPORT_XLSX_FORMAT);
  assert.equal(calls[0].dedupeKey, "product-export:product-core-seo-v1:xlsx");
});

test("product export worker stores xlsx source artifacts with canonical manifest metadata", async () => {
  const putFiles = [];
  const records = [];

  const result = await runProductExportJob({
    artifactCatalog: {
      async record(args) {
        records.push(args);
        return { id: `artifact-${records.length}`, ...args };
      },
      async markDeleted() {
        return true;
      },
    },
    artifactKeyPrefix: "resolved-prefix",
    artifactStorage: {
      async delete() {
        return true;
      },
      async put(args) {
        if (args.key.endsWith("/source.xlsx")) {
          throw new Error("xlsx export should prefer putFile when available");
        }

        return {
          bucket: "artifacts",
          checksumSha256: "sha-manifest",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
          sizeBytes: Buffer.byteLength(args.body),
          visibility: "private",
        };
      },
      async putFile(args) {
        const body = await readFile(args.filePath);
        putFiles.push({ ...args, body, mode: "file" });
        return {
          bucket: "artifacts",
          checksumSha256: `sha-${putFiles.length}`,
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
          sizeBytes: body.byteLength,
          visibility: "private",
        };
      },
    },
    job: {
      id: "job-xlsx-export",
      payload: {
        format: PRODUCT_EXPORT_XLSX_FORMAT,
        profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {},
    async *readProductPages() {
      yield [{
        descriptionHtml: "<p>Body\nLine 2</p>",
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

  const sourceArtifact = putFiles[0];
  const canonicalSource = await canonicalizeProductSpreadsheet({
    body: sourceArtifact.body,
    format: PRODUCT_EXPORT_XLSX_FORMAT,
    profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
  });

  assert.equal(result.format, PRODUCT_EXPORT_XLSX_FORMAT);
  assert.equal(records[0].kind, "product.export.source");
  assert.equal(records[0].metadata.format, PRODUCT_EXPORT_XLSX_FORMAT);
  assert.equal(sourceArtifact.key, "resolved-prefix/product-exports/example.myshopify.com/job-xlsx-export/source.xlsx");
  assert.equal(sourceArtifact.mode, "file");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sourceArtifact.body);
  assert.equal(workbook.getWorksheet(PRODUCT_CORE_SEO_EXPORT_PROFILE)?.getCell("A2").numFmt, "@");
  assert.match(canonicalSource.canonicalCsvText, /sample-product/);
  assert.match(canonicalSource.canonicalCsvText, /<p>Body\nLine 2<\/p>/);
});

test("csv stream parser preserves quoted empty cells across chunk boundaries", async () => {
  const rows = [];

  for await (const row of parseCsvRowsFromStream(Readable.from([
    "product_id,title\n",
    "\"gid://shopify/Product/1\",",
    "\"\"\n",
  ]))) {
    rows.push(row);
  }

  assert.deepEqual(rows, [
    ["product_id", "title"],
    ["gid://shopify/Product/1", ""],
  ]);
});

test("product preview worker canonicalizes xlsx artifacts and keeps preview semantics identical to csv", async () => {
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
  const sourceXlsx = await buildProductSourceBufferFromCanonicalCsv({
    canonicalCsvText: csvText,
    format: PRODUCT_EXPORT_XLSX_FORMAT,
    profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
  });
  const editedXlsx = await buildProductSourceBufferFromCanonicalCsv({
    canonicalCsvText: editedCsv,
    format: PRODUCT_EXPORT_XLSX_FORMAT,
    profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
  });
  const puts = [];

  const result = await runProductPreviewJob({
    artifactCatalog: {
      async record(args) {
        return { id: `artifact-${args.kind}`, ...args };
      },
    },
    artifactKeyPrefix: "resolved-prefix",
    artifactStorage: {
      async get(key) {
        if (key.includes("edited.xlsx")) {
          return Buffer.from(editedXlsx);
        }
        if (key.includes("manifest.json")) {
          return Buffer.from(JSON.stringify(manifest));
        }
        return Buffer.from(sourceXlsx);
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
      id: "job-xlsx-preview",
      payload: {
        editedDigest: "edited",
        editedUploadArtifactId: "edited-artifact",
        exportJobId: "export-1",
        format: PRODUCT_EXPORT_XLSX_FORMAT,
        manifestArtifactId: "manifest-artifact",
        profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
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
              objectKey: "product-previews/example.myshopify.com/upload/edited.xlsx",
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
            objectKey: "product-exports/example.myshopify.com/export-1/source.xlsx",
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

  const payload = JSON.parse(String(puts[0].body));
  assert.equal(result.summary.changed, 1);
  assert.equal(payload.sourceFormat, PRODUCT_EXPORT_XLSX_FORMAT);
  assert.equal(payload.editedFormat, PRODUCT_EXPORT_XLSX_FORMAT);
  assert.equal(payload.editedLayout, "canonical");
  assert.match(payload.editedRowMapDigest, /^[a-f0-9]{64}$/);
  assert.equal(payload.summary.changed, 1);
  assert.equal(payload.rows[0].changedFields[0], "title");
});
