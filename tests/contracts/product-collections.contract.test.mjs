import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createCollectionExportCsvBuilder,
  mapProductNodeToCollectionExportRows,
} from "../../domain/collections/export-csv.mjs";
import {
  buildCollectionPreviewRows,
  indexCollectionRows,
  parseCollectionPreviewCsv,
} from "../../domain/collections/preview-csv.mjs";
import { getWritableCollectionPreviewRows } from "../../domain/collections/write-rows.mjs";
import {
  PRODUCT_EXPORT_PROFILES,
  PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS,
  PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE,
} from "../../domain/products/export-profile.mjs";
import {
  readCollectionsForProducts,
  readProductCollectionPagesForExport,
  resolveCollectionsByHandle,
} from "../../platform/shopify/product-collections.server.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

function graphqlResponse(data) {
  return {
    ok: true,
    async json() {
      return { data };
    },
  };
}

test("product-manual-collections-v1 profile is registered in PRODUCT_EXPORT_PROFILES", () => {
  assert.ok(PRODUCT_EXPORT_PROFILES.includes(PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE));
});

test("collection export CSV headers match ADR-0016 contract", () => {
  assert.deepStrictEqual(
    [...PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS],
    [
      "product_id",
      "product_handle",
      "collection_id",
      "collection_handle",
      "collection_title",
      "membership",
      "updated_at",
    ],
  );
});

test("collection export CSV builder emits manual collection memberships only", () => {
  const builder = createCollectionExportCsvBuilder({
    signingKey: "test-signing-key",
  });
  const chunk = builder.appendProducts([{
    collections: {
      nodes: [
        {
          handle: "summer",
          id: "gid://shopify/Collection/1",
          title: "Summer",
          updatedAt: "2026-03-15T00:00:00Z",
        },
        {
          handle: "smart-sale",
          id: "gid://shopify/Collection/2",
          ruleSet: { appliedDisjunctively: false },
          title: "Smart Sale",
          updatedAt: "2026-03-15T00:00:01Z",
        },
      ],
    },
    handle: "hat",
    id: "gid://shopify/Product/1",
  }]);
  const { rowCount } = builder.finalize();

  assert.equal(chunk.split("\n")[0], PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(","));
  assert.match(chunk, /gid:\/\/shopify\/Collection\/1/);
  assert.doesNotMatch(chunk, /smart-sale/);
  assert.equal(rowCount, 1);
});

test("collection export mapping returns no rows for smart collections", () => {
  const rows = mapProductNodeToCollectionExportRows({
    collections: {
      nodes: [{
        handle: "smart-sale",
        id: "gid://shopify/Collection/2",
        ruleSet: { appliedDisjunctively: false },
        title: "Smart Sale",
      }],
    },
    handle: "hat",
    id: "gid://shopify/Product/1",
  });

  assert.deepStrictEqual(rows, []);
});

test("collection preview CSV parser rejects wrong header", () => {
  assert.throws(
    () => parseCollectionPreviewCsv("wrong_header\nvalue\n"),
    /CSV header must exactly match product-manual-collections-v1/,
  );
});

test("collection preview marks add row changed when current membership is missing", () => {
  const header = PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(",");
  const baselineRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,gid://shopify/Collection/1,summer,Summer,member,2026-03-15T00:00:00Z\n`,
  );
  const editedRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,,winter,Winter,member,\n`,
  );
  const { rows, summary } = buildCollectionPreviewRows({
    baselineRows,
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001egid://shopify/Collection/1", {
        collection_handle: "summer",
        collection_id: "gid://shopify/Collection/1",
        collection_title: "Summer",
        membership: "member",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-15T00:00:00Z",
      }],
    ]),
    editedRows,
    existingProductIds: new Set(["gid://shopify/Product/1"]),
    productRowsById: new Map([
      ["gid://shopify/Product/1", {
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "",
      }],
    ]),
    resolvedCollectionsByHandle: new Map([
      ["winter", {
        handle: "winter",
        id: "gid://shopify/Collection/2",
        title: "Winter",
      }],
    ]),
    resolvedCollectionsById: new Map(),
  });

  assert.equal(rows[0].classification, "changed");
  assert.equal(rows[0].operation, "add");
  assert.deepEqual(rows[0].changedFields, ["membership"]);
  assert.equal(summary.changed, 1);
});

test("collection preview warns when live state drift conflicts with edited intent", () => {
  const header = PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(",");
  const baselineRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,gid://shopify/Collection/1,summer,Summer,member,2026-03-15T00:00:00Z\n`,
  );
  const editedRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,gid://shopify/Collection/1,summer,Summer,member,2026-03-15T00:00:00Z\n`,
  );

  const { rows, summary } = buildCollectionPreviewRows({
    baselineRows,
    currentRowsByKey: new Map(),
    editedRows,
    existingProductIds: new Set(["gid://shopify/Product/1"]),
    productRowsById: new Map([
      ["gid://shopify/Product/1", {
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "",
      }],
    ]),
    resolvedCollectionsByHandle: new Map(),
    resolvedCollectionsById: new Map([
      ["gid://shopify/Collection/1", {
        handle: "summer",
        id: "gid://shopify/Collection/1",
        title: "Summer",
      }],
    ]),
  });

  assert.equal(rows[0].classification, "warning");
  assert.deepEqual(rows[0].changedFields, ["membership"]);
  assert.match(rows[0].messages[0], /changed after the selected export baseline/);
  assert.equal(summary.warning, 1);
});

test("collection writable preview rows include warning rows that still carry a membership change", () => {
  const writableRows = getWritableCollectionPreviewRows([
    {
      changedFields: ["membership"],
      classification: "warning",
      editedRowNumber: 2,
    },
    {
      changedFields: [],
      classification: "warning",
      editedRowNumber: 3,
    },
    {
      changedFields: ["membership"],
      classification: "changed",
      editedRowNumber: 4,
    },
  ]);

  assert.deepEqual(
    writableRows.map((row) => row.editedRowNumber),
    [2, 4],
  );
});

test("collection preview warns when live collection metadata drifted after export baseline", () => {
  const header = PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(",");
  const baselineRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,gid://shopify/Collection/1,summer,Summer,member,2026-03-15T00:00:00Z\n`,
  );
  const editedRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,gid://shopify/Collection/1,summer,Summer,member,2026-03-15T00:00:00Z\n`,
  );

  const { rows, summary } = buildCollectionPreviewRows({
    baselineRows,
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001egid://shopify/Collection/1", {
        collection_handle: "summer",
        collection_id: "gid://shopify/Collection/1",
        collection_title: "Summer 2026",
        membership: "member",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-16T00:00:00Z",
      }],
    ]),
    editedRows,
    existingProductIds: new Set(["gid://shopify/Product/1"]),
    productRowsById: new Map([
      ["gid://shopify/Product/1", {
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "",
      }],
    ]),
    resolvedCollectionsByHandle: new Map(),
    resolvedCollectionsById: new Map([
      ["gid://shopify/Collection/1", {
        handle: "summer",
        id: "gid://shopify/Collection/1",
        title: "Summer 2026",
        updatedAt: "2026-03-16T00:00:00Z",
      }],
    ]),
  });

  assert.equal(rows[0].classification, "warning");
  assert.match(rows[0].messages[0], /changed after the selected export baseline/);
  assert.equal(summary.warning, 1);
});

test("collection preview rejects smart collections", () => {
  const header = PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(",");
  const editedRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,,smart-sale,Smart Sale,member,\n`,
  );

  const { rows, summary } = buildCollectionPreviewRows({
    baselineRows: [],
    currentRowsByKey: new Map(),
    editedRows,
    existingProductIds: new Set(["gid://shopify/Product/1"]),
    productRowsById: new Map([
      ["gid://shopify/Product/1", {
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "",
      }],
    ]),
    resolvedCollectionsByHandle: new Map([
      ["smart-sale", {
        handle: "smart-sale",
        id: "gid://shopify/Collection/2",
        ruleSet: { appliedDisjunctively: false },
        title: "Smart Sale",
      }],
    ]),
    resolvedCollectionsById: new Map(),
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages[0], /smart collections/);
  assert.equal(summary.error, 1);
});

test("collection index captures product ids, handles, and ids", () => {
  const header = PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(",");
  const parsedRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,gid://shopify/Collection/1,summer,Summer,member,\n`,
  );
  const index = indexCollectionRows(parsedRows);

  assert.deepEqual([...index.productIds], ["gid://shopify/Product/1"]);
  assert.deepEqual([...index.collectionIds], ["gid://shopify/Collection/1"]);
  assert.deepEqual([...index.collectionHandles], ["summer"]);
});

test("collection index rejects duplicate raw product and collection rows", () => {
  const header = PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(",");

  assert.throws(
    () => indexCollectionRows(parseCollectionPreviewCsv(
      `${header}\ngid://shopify/Product/1,hat,,summer,Summer,member,\n`
      + `gid://shopify/Product/1,hat,,summer,Summer,member,\n`,
    )),
    /Duplicate collection row detected/,
  );
});

test("collection preview rejects clearing read-only baseline columns", () => {
  const header = PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(",");
  const baselineRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,gid://shopify/Collection/1,summer,Summer,member,2026-03-15T00:00:00Z\n`,
  );
  const editedRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,,gid://shopify/Collection/1,,,remove,2026-03-15T00:00:00Z\n`,
  );

  const { rows, summary } = buildCollectionPreviewRows({
    baselineRows,
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001egid://shopify/Collection/1", {
        collection_handle: "summer",
        collection_id: "gid://shopify/Collection/1",
        collection_title: "Summer",
        membership: "member",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-15T00:00:00Z",
      }],
    ]),
    editedRows,
    existingProductIds: new Set(["gid://shopify/Product/1"]),
    productRowsById: new Map([
      ["gid://shopify/Product/1", {
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "",
      }],
    ]),
    resolvedCollectionsByHandle: new Map(),
    resolvedCollectionsById: new Map([
      ["gid://shopify/Collection/1", {
        handle: "summer",
        id: "gid://shopify/Collection/1",
        title: "Summer",
      }],
    ]),
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages[0], /product_handle is read-only/);
  assert.equal(summary.error, 1);
});

test("collection preview rejects edited updated_at values", () => {
  const header = PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(",");
  const baselineRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,gid://shopify/Collection/1,summer,Summer,member,2026-03-15T00:00:00Z\n`,
  );
  const editedRows = parseCollectionPreviewCsv(
    `${header}\ngid://shopify/Product/1,hat,gid://shopify/Collection/1,summer,Summer,remove,2026-03-16T00:00:00Z\n`,
  );

  const { rows, summary } = buildCollectionPreviewRows({
    baselineRows,
    currentRowsByKey: new Map([
      ["gid://shopify/Product/1\u001egid://shopify/Collection/1", {
        collection_handle: "summer",
        collection_id: "gid://shopify/Collection/1",
        collection_title: "Summer",
        membership: "member",
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "2026-03-15T00:00:00Z",
      }],
    ]),
    editedRows,
    existingProductIds: new Set(["gid://shopify/Product/1"]),
    productRowsById: new Map([
      ["gid://shopify/Product/1", {
        product_handle: "hat",
        product_id: "gid://shopify/Product/1",
        updated_at: "",
      }],
    ]),
    resolvedCollectionsByHandle: new Map(),
    resolvedCollectionsById: new Map([
      ["gid://shopify/Collection/1", {
        handle: "summer",
        id: "gid://shopify/Collection/1",
        title: "Summer",
      }],
    ]),
  });

  assert.equal(rows[0].classification, "error");
  assert.match(rows[0].messages[0], /updated_at is read-only/);
  assert.equal(summary.error, 1);
});

test("collection export adapter paginates nested collections to completion", async () => {
  const calls = [];
  const admin = {
    async graphql(query, { variables } = {}) {
      if (query.includes("ProductCollectionExportPage")) {
        calls.push({ after: variables?.after ?? null });
        return graphqlResponse({
          products: {
            edges: [{
              node: {
                collections: {
                  nodes: [{
                    handle: "summer",
                    id: "gid://shopify/Collection/1",
                    title: "Summer",
                  }],
                  pageInfo: {
                    endCursor: "c-1",
                    hasNextPage: true,
                  },
                },
                handle: "hat",
                id: "gid://shopify/Product/1",
                updatedAt: "2026-03-15T00:00:00Z",
              },
            }],
            pageInfo: {
              endCursor: null,
              hasNextPage: false,
            },
          },
        });
      }

      if (query.includes("ProductCollectionPage")) {
        calls.push({ after: variables.after, productId: variables.productId });
        return graphqlResponse({
          product: {
            collections: {
              nodes: [{
                handle: "winter",
                id: "gid://shopify/Collection/2",
                title: "Winter",
              }],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        });
      }

      throw new Error("unexpected query");
    },
  };

  const pages = [];
  for await (const page of readProductCollectionPagesForExport(admin)) {
    pages.push(page);
  }

  assert.equal(pages[0][0].collections.nodes.length, 2);
  assert.deepEqual(calls, [
    { after: null },
    { after: "c-1", productId: "gid://shopify/Product/1" },
  ]);
});

test("collection read adapter returns current rows for manual memberships only", async () => {
  const admin = {
    async graphql(query) {
      if (query.includes("ProductCollectionRead")) {
        return graphqlResponse({
          product: {
            collections: {
              nodes: [{
                handle: "summer",
                id: "gid://shopify/Collection/1",
                title: "Summer",
              }],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
            handle: "hat",
            id: "gid://shopify/Product/1",
            updatedAt: "",
          },
        });
      }

      throw new Error("unexpected query");
    },
  };

  const result = await readCollectionsForProducts(admin, ["gid://shopify/Product/1"]);

  assert.deepEqual([...result.existingProductIds], ["gid://shopify/Product/1"]);
  assert.ok(result.currentRowsByKey.has("gid://shopify/Product/1\u001egid://shopify/Collection/1"));
});

test("collection handle resolver caches normalized handles", async () => {
  const calls = [];
  const admin = {
    async graphql(_query, { variables }) {
      calls.push(variables.identifier.handle);
      return graphqlResponse({
        collectionByIdentifier: {
          handle: variables.identifier.handle,
          id: `gid://shopify/Collection/${variables.identifier.handle}`,
          title: variables.identifier.handle,
        },
      });
    },
  };

  const result = await resolveCollectionsByHandle(admin, ["summer", "winter"]);

  assert.equal(result.get("summer").id, "gid://shopify/Collection/summer");
  assert.equal(result.get("winter").id, "gid://shopify/Collection/winter");
  assert.deepEqual(calls, ["summer", "winter"]);
});

test("preview page lists manual collection profile", () => {
  const pageFile = readProjectFile("app/routes/app.preview.tsx");

  assert.match(pageFile, /product-manual-collections-v1/);
});

test("product write worker dispatch includes manual collection profile", () => {
  const workerFile = readProjectFile("workers/product-write.mjs");

  assert.match(workerFile, /PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE/);
  assert.match(workerFile, /runCollectionProductWriteJob/);
});
