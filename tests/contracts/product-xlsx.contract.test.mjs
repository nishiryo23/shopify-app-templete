import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

import { buildProductExportArtifacts } from "../../domain/products/export-csv.mjs";
import {
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_EXPORT_XLSX_FORMAT,
  PRODUCT_EXPORT_PROFILES,
} from "../../domain/products/export-profile.mjs";
import {
  buildProductSourceBufferFromCanonicalCsv,
  canonicalizeProductSpreadsheet,
  getProductExportHeaders,
} from "../../domain/products/spreadsheet-format.mjs";
import { parseCsvRowsFromStream, serializeCsvRows } from "../../domain/spreadsheets/csv.mjs";
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
    /exactly one worksheet named product-core-seo-v1/,
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
    /must be text, not number|must not contain a formula/,
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
    /unsupported extra columns/,
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
  assert.equal(payload.format, PRODUCT_EXPORT_XLSX_FORMAT);
  assert.equal(payload.summary.changed, 1);
  assert.equal(payload.rows[0].changedFields[0], "title");
});
