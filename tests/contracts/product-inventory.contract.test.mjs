import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createInventoryExportCsvBuilder } from "../../domain/inventory/export-csv.mjs";
import {
  buildInventoryPreviewRows,
  indexInventoryRows,
  parseInventoryPreviewCsv,
} from "../../domain/inventory/preview-csv.mjs";
import {
  buildInventoryReferenceDocumentUri,
  buildInventorySetQuantityInputFromPreviewRow,
  getWritableInventoryPreviewRows,
} from "../../domain/inventory/write-rows.mjs";
import { PRODUCT_INVENTORY_EXPORT_HEADERS } from "../../domain/products/export-profile.mjs";
import {
  readInventoryLevelsForProducts,
  readProductInventoryPagesForExport,
} from "../../platform/shopify/product-inventory.server.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("inventory export CSV profile keeps inventory headers and rows", () => {
  const builder = createInventoryExportCsvBuilder({
    signingKey: "test-signing-key",
  });
  const chunk = builder.appendVariants([{
    id: "gid://shopify/ProductVariant/1",
    inventoryItem: {
      inventoryLevels: {
        nodes: [{
          location: {
            id: "gid://shopify/Location/1",
            name: "Tokyo",
          },
          quantities: [{ name: "available", quantity: 12 }],
          updatedAt: "2026-03-14T00:00:00Z",
        }],
      },
    },
    product: {
      handle: "hat",
      id: "gid://shopify/Product/1",
      options: [{ name: "Color", position: 1 }],
    },
    selectedOptions: [{ name: "Color", value: "Red" }],
  }]);
  const { manifest, rowCount } = builder.finalize();

  assert.equal(chunk.split("\n")[0], PRODUCT_INVENTORY_EXPORT_HEADERS.join(","));
  assert.match(chunk, /gid:\/\/shopify\/Location\/1/);
  assert.match(chunk, /Tokyo/);
  assert.match(chunk, /12/);
  assert.equal(rowCount, 1);
  assert.equal(manifest.rowFingerprints.length, 2);
});

test("inventory preview warns when live quantity drifted after baseline", () => {
  const baselineRows = parseInventoryPreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,location_id,location_name,available,updated_at\n"
    + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/1,Color,Red,,,,,gid://shopify/Location/1,Tokyo,10,2026-03-14T00:00:00Z\n",
  );
  const editedRows = parseInventoryPreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,location_id,location_name,available,updated_at\n"
    + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/1,Color,Red,,,,,gid://shopify/Location/1,Tokyo,12,2026-03-14T00:00:00Z\n",
  );
  const { rows, summary } = buildInventoryPreviewRows({
    baselineRowsByKey: new Map([
      ["gid://shopify/ProductVariant/1\u001egid://shopify/Location/1", baselineRows[0]],
    ]),
    currentRowsByKey: new Map([
      ["gid://shopify/ProductVariant/1\u001egid://shopify/Location/1", {
        available: "9",
        inventory_item_id: "gid://shopify/InventoryItem/1",
        location_id: "gid://shopify/Location/1",
        location_name: "Tokyo",
        option1_name: "Color",
        option1_value: "Red",
        option2_name: "",
        option2_value: "",
        option3_name: "",
        option3_value: "",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-14T00:00:01Z",
        variant_id: "gid://shopify/ProductVariant/1",
      }],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "warning");
  assert.match(rows[0].messages[0], /changed after the selected export baseline/);
  assert.deepEqual(rows[0].changedFields, []);
  assert.equal(summary.warning, 1);
  assert.deepEqual(getWritableInventoryPreviewRows(rows), []);
});

test("inventory preview rejects edited rows that retarget variant_id or location_id", () => {
  const baselineRows = parseInventoryPreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,location_id,location_name,available,updated_at\n"
    + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/1,Color,Red,,,,,gid://shopify/Location/1,Tokyo,10,2026-03-14T00:00:00Z\n",
  );
  const editedRows = parseInventoryPreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,location_id,location_name,available,updated_at\n"
    + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/2,Color,Red,,,,,gid://shopify/Location/2,Osaka,12,2026-03-14T00:00:00Z\n",
  );
  const currentRowsByKey = new Map([
    ["gid://shopify/ProductVariant/1\u001egid://shopify/Location/1", {
      available: "10",
      inventory_item_id: "gid://shopify/InventoryItem/1",
      location_id: "gid://shopify/Location/1",
      location_name: "Tokyo",
      option1_name: "Color",
      option1_value: "Red",
      option2_name: "",
      option2_value: "",
      option3_name: "",
      option3_value: "",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-14T00:00:00Z",
      variant_id: "gid://shopify/ProductVariant/1",
    }],
    ["gid://shopify/ProductVariant/2\u001egid://shopify/Location/2", {
      available: "15",
      inventory_item_id: "gid://shopify/InventoryItem/2",
      location_id: "gid://shopify/Location/2",
      location_name: "Osaka",
      option1_name: "Color",
      option1_value: "Red",
      option2_name: "",
      option2_value: "",
      option3_name: "",
      option3_value: "",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-14T00:00:00Z",
      variant_id: "gid://shopify/ProductVariant/2",
    }],
  ]);
  const { rows, summary } = buildInventoryPreviewRows({
    baselineRowsByKey: new Map([
      ["gid://shopify/ProductVariant/1\u001egid://shopify/Location/1", baselineRows[0]],
    ]),
    currentRowsByKey,
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages.join("\n"), /variant_id \+ location_id was not present/);
  assert.equal(summary.error, 1);
});

test("inventory preview ignores non-quantity live drift for stale detection", () => {
  const baselineRows = parseInventoryPreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,location_id,location_name,available,updated_at\n"
    + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/1,Color,Red,,,,,gid://shopify/Location/1,Tokyo,10,2026-03-14T00:00:00Z\n",
  );
  const editedRows = parseInventoryPreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,location_id,location_name,available,updated_at\n"
    + "gid://shopify/Product/1,hat,gid://shopify/ProductVariant/1,Color,Red,,,,,gid://shopify/Location/1,Tokyo,12,2026-03-14T00:00:00Z\n",
  );
  const { rows, summary } = buildInventoryPreviewRows({
    baselineRowsByKey: new Map([
      ["gid://shopify/ProductVariant/1\u001egid://shopify/Location/1", baselineRows[0]],
    ]),
    currentRowsByKey: new Map([
      ["gid://shopify/ProductVariant/1\u001egid://shopify/Location/1", {
        available: "10",
        inventory_item_id: "gid://shopify/InventoryItem/1",
        location_id: "gid://shopify/Location/1",
        location_name: "Tokyo renamed",
        option1_name: "Color",
        option1_value: "Red",
        option2_name: "",
        option2_value: "",
        option3_name: "",
        option3_value: "",
        product_handle: "hat-renamed",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-14T00:00:01Z",
        variant_id: "gid://shopify/ProductVariant/1",
      }],
    ]),
    editedRows,
  });

  assert.equal(rows[0].classification, "changed");
  assert.deepEqual(rows[0].messages, []);
  assert.equal(summary.changed, 1);
  assert.deepEqual(getWritableInventoryPreviewRows(rows).map((row) => row.editedRowNumber), [2]);
});

test("inventory preview index ignores duplicate missing identity rows so row validation can report them", () => {
  const editedRows = parseInventoryPreviewCsv(
    "product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,location_id,location_name,available,updated_at\n"
    + "gid://shopify/Product/1,hat,,Color,Red,,,,,,Tokyo,12,2026-03-14T00:00:00Z\n"
    + "gid://shopify/Product/1,hat,,Color,Red,,,,,,Tokyo,13,2026-03-14T00:00:00Z\n",
  );

  assert.doesNotThrow(() => indexInventoryRows(editedRows));

  const { rows, summary } = buildInventoryPreviewRows({
    baselineRowsByKey: new Map(),
    currentRowsByKey: new Map(),
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.equal(rows[1].classification, "error");
  assert.match(rows[0].messages.join("\n"), /variant_id is required/);
  assert.match(rows[1].messages.join("\n"), /variant_id is required/);
  assert.equal(summary.error, 2);
});

test("inventory reader paginates inventory levels beyond 250 active locations", async () => {
  const adminCalls = [];
  const admin = {
    async graphql(query, { variables }) {
      adminCalls.push({
        query,
        variables,
      });

      if (query.includes("ProductInventoryPreviewProduct")) {
        return Response.json({
          data: {
            node: {
              id: "gid://shopify/Product/1",
              handle: "hat",
              options: [{ name: "Color", position: 1 }],
              variants: {
                nodes: [{
                  id: "gid://shopify/ProductVariant/1",
                  updatedAt: "2026-03-14T00:00:00Z",
                  selectedOptions: [{ name: "Color", value: "Red" }],
                  inventoryItem: {
                    id: "gid://shopify/InventoryItem/1",
                    inventoryLevels: {
                      nodes: [{
                        updatedAt: "2026-03-14T00:00:00Z",
                        location: {
                          id: "gid://shopify/Location/1",
                          name: "Tokyo",
                        },
                        quantities: [{ name: "available", quantity: 10 }],
                      }],
                      pageInfo: {
                        endCursor: "cursor-1",
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
          },
        });
      }

      assert.match(query, /InventoryItemLevelsPage/);
      assert.equal(variables.id, "gid://shopify/InventoryItem/1");
      assert.equal(variables.after, "cursor-1");

      return Response.json({
        data: {
          node: {
            id: "gid://shopify/InventoryItem/1",
            inventoryLevels: {
              nodes: [{
                updatedAt: "2026-03-14T00:00:01Z",
                location: {
                  id: "gid://shopify/Location/2",
                  name: "Osaka",
                },
                quantities: [{ name: "available", quantity: 11 }],
              }],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        },
      });
    },
  };

  const result = await readInventoryLevelsForProducts(admin, ["gid://shopify/Product/1"]);

  assert.equal(result.rowsByKey.size, 2);
  assert.equal(
    result.rowsByKey.get("gid://shopify/ProductVariant/1\u001egid://shopify/Location/2")?.available,
    "11",
  );
  assert.equal(adminCalls.length, 2);
});

test("inventory export reader paginates inventory levels beyond 250 active locations", async () => {
  const adminCalls = [];
  const admin = {
    async graphql(query, { variables }) {
      adminCalls.push({
        query,
        variables,
      });

      if (query.includes("ProductInventoryExportPage")) {
        return Response.json({
          data: {
            productVariants: {
              edges: [{
                cursor: "variant-cursor-1",
                node: {
                  id: "gid://shopify/ProductVariant/1",
                  updatedAt: "2026-03-14T00:00:00Z",
                  selectedOptions: [{ name: "Color", value: "Red" }],
                  product: {
                    id: "gid://shopify/Product/1",
                    handle: "hat",
                    options: [{ name: "Color", position: 1 }],
                  },
                  inventoryItem: {
                    id: "gid://shopify/InventoryItem/1",
                    inventoryLevels: {
                      nodes: [{
                        updatedAt: "2026-03-14T00:00:00Z",
                        location: {
                          id: "gid://shopify/Location/1",
                          name: "Tokyo",
                        },
                        quantities: [{ name: "available", quantity: 10 }],
                      }],
                      pageInfo: {
                        endCursor: "cursor-1",
                        hasNextPage: true,
                      },
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
        });
      }

      assert.match(query, /InventoryItemLevelsPage/);
      assert.equal(variables.id, "gid://shopify/InventoryItem/1");
      assert.equal(variables.after, "cursor-1");

      return Response.json({
        data: {
          node: {
            id: "gid://shopify/InventoryItem/1",
            inventoryLevels: {
              nodes: [{
                updatedAt: "2026-03-14T00:00:01Z",
                location: {
                  id: "gid://shopify/Location/2",
                  name: "Osaka",
                },
                quantities: [{ name: "available", quantity: 11 }],
              }],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        },
      });
    },
  };

  const pages = [];
  for await (const page of readProductInventoryPagesForExport(admin)) {
    pages.push(page);
  }

  assert.equal(pages.length, 1);
  assert.equal(pages[0].length, 1);
  assert.equal(pages[0][0].inventoryItem.inventoryLevels.nodes.length, 2);

  const builder = createInventoryExportCsvBuilder({
    signingKey: "test-signing-key",
  });
  const csvChunk = builder.appendVariants(pages[0]);

  assert.match(csvChunk, /gid:\/\/shopify\/Location\/1/);
  assert.match(csvChunk, /gid:\/\/shopify\/Location\/2/);
  assert.match(csvChunk, /Osaka/);
  assert.equal(adminCalls.length, 2);
});

test("inventory write input includes compare-and-set quantity and reference document uri", () => {
  const result = buildInventorySetQuantityInputFromPreviewRow({
    currentRow: {
      available: "10",
      inventory_item_id: "gid://shopify/InventoryItem/1",
      location_id: "gid://shopify/Location/1",
    },
    editedRow: {
      available: "012",
    },
    locationId: "gid://shopify/Location/1",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.input, {
    changeFromQuantity: 10,
    inventoryItemId: "gid://shopify/InventoryItem/1",
    locationId: "gid://shopify/Location/1",
    quantity: 12,
  });
  assert.equal(
    buildInventoryReferenceDocumentUri("preview-job-1"),
    "gid://matri/ProductPreview/preview-job-1",
  );
});

test("preview page lists inventory profile", () => {
  const pageFile = readProjectFile("app/routes/app.preview.tsx");

  assert.match(pageFile, /product-inventory-v1/);
});

test("preview service latest-write lookup is not limited to product core profile", () => {
  const serviceFile = readProjectFile("app/services/product-previews.server.ts");

  assert.doesNotMatch(serviceFile, /profile !== PRODUCT_CORE_SEO_EXPORT_PROFILE/);
  assert.match(serviceFile, /findLatestRollbackableWriteState\(\{/);
});
