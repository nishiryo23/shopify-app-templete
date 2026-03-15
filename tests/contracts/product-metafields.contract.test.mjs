import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createMetafieldExportCsvBuilder,
  mapProductNodeToMetafieldExportRows,
} from "../../domain/metafields/export-csv.mjs";
import {
  buildMetafieldPreviewRows,
  canonicalizeMetafieldStoredValue,
  indexMetafieldRows,
  normalizeMetafieldForWrite,
  parseMetafieldPreviewCsv,
} from "../../domain/metafields/preview-csv.mjs";
import {
  buildMetafieldSetInputFromPreviewRow,
  getWritableMetafieldPreviewRows,
} from "../../domain/metafields/write-rows.mjs";
import {
  PRODUCT_EXPORT_PROFILES,
  PRODUCT_METAFIELDS_EXPORT_HEADERS,
  PRODUCT_METAFIELDS_EXPORT_PROFILE,
} from "../../domain/products/export-profile.mjs";
import {
  readMetafieldsForProducts,
  readProductMetafieldPagesForExport,
} from "../../platform/shopify/product-metafields.server.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("product-metafields-v1 profile is registered in PRODUCT_EXPORT_PROFILES", () => {
  assert.ok(PRODUCT_EXPORT_PROFILES.includes(PRODUCT_METAFIELDS_EXPORT_PROFILE));
});

test("metafield export CSV headers match ADR-0015 contract", () => {
  assert.deepStrictEqual(
    [...PRODUCT_METAFIELDS_EXPORT_HEADERS],
    [
      "product_id",
      "product_handle",
      "namespace",
      "key",
      "type",
      "value",
      "updated_at",
    ],
  );
});

test("metafield export CSV builder emits supported rows and skipped metadata", () => {
  const builder = createMetafieldExportCsvBuilder({
    signingKey: "test-signing-key",
  });
  const chunk = builder.appendProducts([{
    handle: "hat",
    id: "gid://shopify/Product/1",
    metafields: {
      nodes: [
        {
          key: "subtitle",
          namespace: "custom",
          type: "single_line_text_field",
          updatedAt: "2026-03-15T00:00:00Z",
          value: "Top seller",
        },
        {
          key: "json_data",
          namespace: "custom",
          type: "json",
          updatedAt: "2026-03-15T00:00:01Z",
          value: "{\"a\":1}",
        },
      ],
    },
  }]);
  const { manifest, metadata, rowCount } = builder.finalize();

  assert.equal(chunk.split("\n")[0], PRODUCT_METAFIELDS_EXPORT_HEADERS.join(","));
  assert.match(chunk, /subtitle/);
  assert.doesNotMatch(chunk, /json_data/);
  assert.equal(rowCount, 1);
  assert.equal(metadata.skippedMetafieldsCount, 1);
  assert.deepEqual(metadata.skippedMetafieldTypes, ["json"]);
  assert.equal(manifest.rowFingerprints.length, 2);
});

test("metafield export mapping normalizes multiline values and filters unsupported types", () => {
  const result = mapProductNodeToMetafieldExportRows({
    handle: "hat",
    id: "gid://shopify/Product/1",
    metafields: {
      nodes: [
        {
          key: "details",
          namespace: "custom",
          type: "multi_line_text_field",
          updatedAt: "2026-03-15T00:00:00Z",
          value: "line1\r\nline2",
        },
        {
          key: "payload",
          namespace: "custom",
          type: "json",
          updatedAt: "2026-03-15T00:00:00Z",
          value: "{}",
        },
      ],
    },
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].value, "line1\nline2");
  assert.equal(result.skippedCount, 1);
});

test("metafield preview CSV parser rejects wrong header", () => {
  assert.throws(
    () => parseMetafieldPreviewCsv("wrong_header\nvalue\n"),
    /CSV header must exactly match product-metafields-v1/,
  );
});

test("metafield preview detects changed value", () => {
  const header = PRODUCT_METAFIELDS_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,custom,subtitle,single_line_text_field,Old value,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,custom,subtitle,single_line_text_field,New value,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMetafieldPreviewCsv(baselineCsv);
  const editedRows = parseMetafieldPreviewCsv(editedCsv);
  const { rows, summary } = buildMetafieldPreviewRows({
    baselineRowsByKey: indexMetafieldRows(baselineRows).rowsByKey,
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001ecustom\u001esubtitle", {
        key: "subtitle",
        namespace: "custom",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        type: "single_line_text_field",
        updated_at: "2026-03-15T00:00:00Z",
        value: "Old value",
      }],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "changed");
  assert.deepEqual(rows[0].changedFields, ["value"]);
  assert.equal(summary.changed, 1);
  assert.equal(getWritableMetafieldPreviewRows(rows).length, 1);
});

test("metafield preview trims namespace and key for row identity", () => {
  const header = PRODUCT_METAFIELDS_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat, custom , subtitle ,single_line_text_field,Old value,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,custom,subtitle,single_line_text_field,New value,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMetafieldPreviewCsv(baselineCsv);
  const editedRows = parseMetafieldPreviewCsv(editedCsv);
  const { rows, summary } = buildMetafieldPreviewRows({
    baselineRowsByKey: indexMetafieldRows(baselineRows).rowsByKey,
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001ecustom\u001esubtitle", {
        key: "subtitle",
        namespace: "custom",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        type: "single_line_text_field",
        updated_at: "2026-03-15T00:00:00Z",
        value: "Old value",
      }],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "changed");
  assert.equal(rows[0].namespace, "custom");
  assert.equal(rows[0].key, "subtitle");
  assert.deepEqual(rows[0].changedFields, ["value"]);
  assert.equal(summary.changed, 1);
});

test("metafield preview warns when live metafield drifted after baseline", () => {
  const header = PRODUCT_METAFIELDS_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,custom,subtitle,single_line_text_field,Old value,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,custom,subtitle,single_line_text_field,New value,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMetafieldPreviewCsv(baselineCsv);
  const editedRows = parseMetafieldPreviewCsv(editedCsv);
  const { rows, summary } = buildMetafieldPreviewRows({
    baselineRowsByKey: indexMetafieldRows(baselineRows).rowsByKey,
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001ecustom\u001esubtitle", {
        key: "subtitle",
        namespace: "custom",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        type: "single_line_text_field",
        updated_at: "2026-03-15T00:00:01Z",
        value: "Drifted value",
      }],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "warning");
  assert.match(rows[0].messages[0], /changed after the selected export baseline/);
  assert.equal(summary.warning, 1);
});

test("metafield preview treats row added after baseline as create when current is absent", () => {
  const header = PRODUCT_METAFIELDS_EXPORT_HEADERS.join(",");
  const editedRows = parseMetafieldPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,custom,subtitle,single_line_text_field,New value,\n`,
  );

  const { rows, summary } = buildMetafieldPreviewRows({
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
    editedRows,
  });

  assert.equal(rows[0].classification, "changed");
  assert.equal(rows[0].operation, "create");
  assert.deepEqual(rows[0].changedFields, ["type", "value"]);
  assert.equal(summary.changed, 1);
});

test("metafield preview rejects create rows when read-only product columns drift from Shopify", () => {
  const header = PRODUCT_METAFIELDS_EXPORT_HEADERS.join(",");
  const editedRows = parseMetafieldPreviewCsv(
    `${header}\ngid://shopify/Product/1,wrong-handle,custom,subtitle,single_line_text_field,New value,2026-03-15T00:00:00Z\n`,
  );

  const { rows, summary } = buildMetafieldPreviewRows({
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
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages.join("\n"), /product_handle is read-only/);
  assert.match(rows[0].messages.join("\n"), /updated_at is read-only/);
  assert.equal(summary.error, 1);
  assert.equal(getWritableMetafieldPreviewRows(rows).length, 0);
});

test("metafield preview rejects create rows when owner product does not exist", () => {
  const header = PRODUCT_METAFIELDS_EXPORT_HEADERS.join(",");
  const editedRows = parseMetafieldPreviewCsv(
    `${header}\ngid://shopify/Product/999,missing,custom,subtitle,single_line_text_field,New value,\n`,
  );

  const { rows, summary } = buildMetafieldPreviewRows({
    baselineRowsByKey: new Map(),
    currentRowsByKey: new Map(),
    existingProductIds: new Set(),
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.equal(rows[0].operation, "create");
  assert.match(rows[0].messages.join("\n"), /owner product does not exist in Shopify/);
  assert.equal(summary.error, 1);
  assert.equal(getWritableMetafieldPreviewRows(rows).length, 0);
});

test("metafield preview rejects blank value and type mismatch", () => {
  const header = PRODUCT_METAFIELDS_EXPORT_HEADERS.join(",");
  const editedRows = parseMetafieldPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,custom,subtitle,number_integer,,\n`,
  );

  const { rows, summary } = buildMetafieldPreviewRows({
    baselineRowsByKey: new Map(),
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001ecustom\u001esubtitle", {
        key: "subtitle",
        namespace: "custom",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        type: "single_line_text_field",
        updated_at: "2026-03-15T00:00:00Z",
        value: "Old value",
      }],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages.join("\n"), /value is required/);
  assert.match(rows[0].messages.join("\n"), /type mismatch/);
  assert.equal(summary.error, 1);
});

test("metafield write input normalizes boolean values", () => {
  const result = buildMetafieldSetInputFromPreviewRow({
    editedRow: {
      key: "featured",
      namespace: "custom",
      type: "boolean",
      value: " TRUE ",
    },
    productId: "gid://shopify/Product/1",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.input, {
    key: "featured",
    namespace: "custom",
    ownerId: "gid://shopify/Product/1",
    type: "boolean",
    value: "true",
  });
});

test("numeric metafield normalization preserves large integer and decimal strings", () => {
  assert.equal(
    canonicalizeMetafieldStoredValue("number_integer", "9007199254740993"),
    "9007199254740993",
  );
  assert.equal(
    canonicalizeMetafieldStoredValue("number_decimal", "1234567890.123456789012345678"),
    "1234567890.123456789012345678",
  );
  assert.equal(
    normalizeMetafieldForWrite("number_integer", " 9007199254740993 "),
    "9007199254740993",
  );
  assert.equal(
    normalizeMetafieldForWrite("number_decimal", " 1234567890.123456789012345678 "),
    "1234567890.123456789012345678",
  );
});

test("metafield export reader paginates product metafields for export", async () => {
  const calls = [];
  const admin = {
    async graphql(_query, { variables } = {}) {
      calls.push(variables ?? {});
      if (!variables?.after && !variables?.productId) {
        return {
          ok: true,
          async json() {
            return {
              data: {
                products: {
                  edges: [{
                    cursor: "cursor-1",
                    node: {
                      handle: "hat",
                      id: "gid://shopify/Product/1",
                      metafields: {
                        nodes: [{
                          key: "subtitle",
                          namespace: "custom",
                          type: "single_line_text_field",
                          updatedAt: "2026-03-15T00:00:00Z",
                          value: "Top seller",
                        }],
                        pageInfo: {
                          endCursor: "mf-1",
                          hasNextPage: true,
                        },
                      },
                    },
                  }],
                  pageInfo: {
                    endCursor: null,
                    hasNextPage: false,
                  },
                },
              },
            };
          },
        };
      }

      return {
        ok: true,
        async json() {
          return {
            data: {
              product: {
                handle: "hat",
                id: "gid://shopify/Product/1",
                metafields: {
                  nodes: [{
                    key: "featured",
                    namespace: "custom",
                    type: "boolean",
                    updatedAt: "2026-03-15T00:00:01Z",
                    value: "true",
                  }],
                  pageInfo: {
                    endCursor: null,
                    hasNextPage: false,
                  },
                },
              },
            },
          };
        },
      };
    },
  };

  const pages = [];
  for await (const page of readProductMetafieldPagesForExport(admin)) {
    pages.push(page);
  }

  assert.equal(pages.length, 1);
  assert.equal(pages[0][0].metafields.nodes.length, 2);
  assert.deepEqual(calls, [{ after: null }, { after: "mf-1", productId: "gid://shopify/Product/1" }]);
});

test("metafield reader paginates product metafields for preview and verification", async () => {
  const calls = [];
  const admin = {
    async graphql(_query, { variables } = {}) {
      calls.push(variables ?? {});
      if (!variables?.after) {
        return {
          ok: true,
          async json() {
            return {
              data: {
                product: {
                  handle: "hat",
                  id: "gid://shopify/Product/1",
                  metafields: {
                    nodes: [{
                      key: "subtitle",
                      namespace: "custom",
                      type: "single_line_text_field",
                      updatedAt: "2026-03-15T00:00:00Z",
                      value: "Top seller",
                    }],
                    pageInfo: {
                      endCursor: "mf-1",
                      hasNextPage: true,
                    },
                  },
                },
              },
            };
          },
        };
      }

      return {
        ok: true,
        async json() {
          return {
            data: {
              product: {
                handle: "hat",
                id: "gid://shopify/Product/1",
                metafields: {
                  nodes: [{
                    key: "featured",
                    namespace: "custom",
                    type: "boolean",
                    updatedAt: "2026-03-15T00:00:01Z",
                    value: "true",
                  }],
                  pageInfo: {
                    endCursor: null,
                    hasNextPage: false,
                  },
                },
              },
            },
          };
        },
      };
    },
  };

  const { existingProductIds, productRowsById, rowsByKey } = await readMetafieldsForProducts(admin, ["gid://shopify/Product/1"]);

  assert.equal(rowsByKey.size, 2);
  assert.deepEqual([...existingProductIds], ["gid://shopify/Product/1"]);
  assert.deepEqual(productRowsById.get("gid://shopify/Product/1"), {
    product_handle: "hat",
    product_id: "gid://shopify/Product/1",
    updated_at: "",
  });
  assert.ok(rowsByKey.has("gid://shopify/Product/1\u001ecustom\u001esubtitle"));
  assert.ok(rowsByKey.has("gid://shopify/Product/1\u001ecustom\u001efeatured"));
  assert.deepEqual(calls, [{ productId: "gid://shopify/Product/1" }, { after: "mf-1", productId: "gid://shopify/Product/1" }]);
});

test("preview page lists metafield profile", () => {
  const pageFile = readProjectFile("app/routes/app.preview.tsx");

  assert.match(pageFile, /product-metafields-v1/);
});

test("product write worker dispatch includes metafield profile", () => {
  const workerFile = readProjectFile("workers/product-write.mjs");

  assert.match(workerFile, /PRODUCT_METAFIELDS_EXPORT_PROFILE/);
  assert.match(workerFile, /runMetafieldProductWriteJob/);
});
