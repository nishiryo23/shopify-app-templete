import test from "node:test";
import assert from "node:assert/strict";

import { createMediaExportCsvBuilder, mapMediaNodeToExportRows } from "../../domain/media/export-csv.mjs";
import {
  buildMediaPreviewRows,
  indexMediaRows,
  parseMediaPreviewCsv,
} from "../../domain/media/preview-csv.mjs";
import {
  buildMediaCreateInputFromPreviewRow,
  buildMediaDeleteInputFromPreviewRow,
  buildMediaReorderMovesForProduct,
  buildMediaUpdateInputFromPreviewRow,
  getWritableMediaPreviewRows,
  mediaChangedFieldsMatch,
} from "../../domain/media/write-rows.mjs";
import {
  PRODUCT_MEDIA_EXPORT_HEADERS,
  PRODUCT_MEDIA_EXPORT_PROFILE,
  PRODUCT_EXPORT_PROFILES,
} from "../../domain/products/export-profile.mjs";
import { readMediaForProducts } from "../../platform/shopify/product-media.server.mjs";

function indexBaselineMediaRows(parsedRows) {
  return indexMediaRows(parsedRows);
}

test("product-media-v1 profile is registered in PRODUCT_EXPORT_PROFILES", () => {
  assert.ok(PRODUCT_EXPORT_PROFILES.includes(PRODUCT_MEDIA_EXPORT_PROFILE));
});

test("media export CSV headers match ADR-0014 contract", () => {
  assert.deepStrictEqual(
    [...PRODUCT_MEDIA_EXPORT_HEADERS],
    [
      "product_id",
      "product_handle",
      "media_id",
      "media_content_type",
      "image_src",
      "image_alt",
      "image_position",
      "updated_at",
    ],
  );
});

test("media export CSV builder produces valid rows from product media nodes", () => {
  const builder = createMediaExportCsvBuilder({
    signingKey: "test-signing-key",
  });
  const chunk = builder.appendProducts([{
    handle: "hat",
    id: "gid://shopify/Product/1",
    media: {
      nodes: [{
        alt: "Red hat front",
        id: "gid://shopify/MediaImage/1",
        image: {
          url: "https://cdn.shopify.com/hat-front.jpg",
        },
        mediaContentType: "IMAGE",
        updatedAt: "2026-03-15T00:00:00Z",
      }],
    },
    updatedAt: "2026-03-15T00:00:00Z",
  }]);
  const { manifest, rowCount } = builder.finalize();

  assert.equal(chunk.split("\n")[0], PRODUCT_MEDIA_EXPORT_HEADERS.join(","));
  assert.match(chunk, /gid:\/\/shopify\/MediaImage\/1/);
  assert.match(chunk, /hat-front\.jpg/);
  assert.match(chunk, /Red hat front/);
  assert.equal(rowCount, 1);
  assert.equal(manifest.rowFingerprints.length, 2);
});

test("media export emits placeholder row for products without IMAGE media", () => {
  const rows = mapMediaNodeToExportRows({
    handle: "hat",
    id: "gid://shopify/Product/1",
    media: {
      nodes: [
        { alt: "Video", id: "m-video", preview: { image: { url: "https://video.jpg" } }, mediaContentType: "VIDEO" },
      ],
    },
    updatedAt: "2026-03-15T00:00:00Z",
  });

  assert.deepStrictEqual(rows, [{
    image_alt: "",
    image_position: "",
    image_src: "",
    media_content_type: "IMAGE",
    media_id: "",
    product_handle: "hat",
    product_id: "gid://shopify/Product/1",
    updated_at: "2026-03-15T00:00:00Z",
  }]);
});

test("mapMediaNodeToExportRows preserves global media position across mixed media", () => {
  const rows = mapMediaNodeToExportRows({
    handle: "hat",
    id: "gid://shopify/Product/1",
    media: {
      nodes: [
        { alt: "First", id: "m1", image: { url: "https://a.jpg" }, mediaContentType: "IMAGE" },
        { alt: "Video", id: "m-video", preview: { image: { url: "https://video.jpg" } }, mediaContentType: "VIDEO" },
        { alt: "Second", id: "m2", image: { url: "https://b.jpg" }, mediaContentType: "IMAGE" },
      ],
    },
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].image_position, "1");
  assert.equal(rows[1].image_position, "3");
});

test("media preview CSV parser rejects wrong header", () => {
  assert.throws(
    () => parseMediaPreviewCsv("wrong_header\nvalue\n"),
    /CSV ヘッダーは product-media-v1 と完全一致する必要があります/,
  );
});

test("media preview detects changed alt text", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Old alt,1,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,New alt,1,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const currentRowsByKey = new Map([
    ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
      image_alt: "Old alt",
      image_position: "1",
      image_src: "https://a.jpg",
      media_content_type: "IMAGE",
      media_id: "gid://shopify/MediaImage/1",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-15T00:00:00Z",
    }],
  ]);

  const { rows, summary } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey,
    editedRows,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].classification, "changed");
  assert.deepStrictEqual(rows[0].changedFields, ["image_alt"]);
  assert.equal(summary.changed, 1);
});

test("media preview warns when live Shopify media source drifted from the export baseline", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Old alt,1,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,New alt,1,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const currentRowsByKey = new Map([
    ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
      image_alt: "Old alt",
      image_position: "1",
      image_src: "https://cdn.shopify.com/replaced.jpg",
      media_content_type: "IMAGE",
      media_id: "gid://shopify/MediaImage/1",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-15T00:00:00Z",
    }],
  ]);

  const { rows, summary } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey,
    editedRows,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].classification, "warning");
  assert.deepStrictEqual(rows[0].changedFields, []);
  assert.match(rows[0].messages[0], /選択したエクスポート baseline 以降/);
  assert.equal(summary.warning, 1);
});

test("media preview treats blank image_position on existing media as keep-current-order", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Old alt,2,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Old alt,,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const currentRowsByKey = new Map([
    ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
      image_alt: "Old alt",
      image_position: "2",
      image_src: "https://a.jpg",
      media_content_type: "IMAGE",
      media_id: "gid://shopify/MediaImage/1",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-15T00:00:00Z",
    }],
  ]);

  const { rows, summary } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey,
    editedRows,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].classification, "unchanged");
  assert.deepStrictEqual(rows[0].changedFields, []);
  assert.equal(summary.unchanged, 1);
});

test("media preview classifies placeholder row edit as create for products without images", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,,IMAGE,,,,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,,IMAGE,https://new.jpg,New image,,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const { rows } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey: new Map(),
    editedRows,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].classification, "changed");
  assert.equal(rows[0].operation, "create");
});

test("media preview allows multiple new media rows for the same placeholder product", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,,IMAGE,,,,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,,IMAGE,https://one.jpg,First image,1,2026-03-15T00:00:00Z\ngid://shopify/Product/1,hat,,IMAGE,https://two.jpg,Second image,2,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const { rows, summary } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey: new Map(),
    editedRows,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].operation, "create");
  assert.equal(rows[1].operation, "create");
  assert.equal(summary.changed, 2);
});

test("media preview keeps exported placeholder row unchanged until image_src is filled", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,,IMAGE,,,,2026-03-15T00:00:00Z\n`;
  const editedCsv = baselineCsv;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const { rows, summary } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey: new Map(),
    editedRows,
  });

  assert.equal(rows[0].classification, "unchanged");
  assert.equal(rows[0].operation, "update");
  assert.equal(summary.unchanged, 1);
});

test("media preview rejects invalid image_position for new media row", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Alt,1,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,,IMAGE,https://new.jpg,New image,0,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const { rows } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey: new Map(),
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.ok(rows[0].messages.some((msg) => msg.includes("1 以上の整数")));
});

test("media preview rejects non-IMAGE media_content_type for new media row", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Alt,1,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,,VIDEO,https://new.jpg,New image,2,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const { rows } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey: new Map(),
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.ok(rows[0].messages.some((msg) => msg.includes("空欄または IMAGE")));
});

test("media preview classifies empty image_src on existing media as delete", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Alt,1,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,,Alt,1,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const currentRowsByKey = new Map([
    ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
      image_alt: "Alt",
      image_position: "1",
      image_src: "https://a.jpg",
      media_content_type: "IMAGE",
      media_id: "gid://shopify/MediaImage/1",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-15T00:00:00Z",
    }],
  ]);

  const { rows } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey,
    editedRows,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].classification, "changed");
  assert.equal(rows[0].operation, "delete");
});

test("media preview warns when live media changed after baseline", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Alt,1,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,New alt,1,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const currentRowsByKey = new Map([
    ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
      image_alt: "Drifted alt",
      image_position: "1",
      image_src: "https://a.jpg",
      media_content_type: "IMAGE",
      media_id: "gid://shopify/MediaImage/1",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-15T00:00:00Z",
    }],
  ]);

  const { rows, summary } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey,
    editedRows,
  });

  assert.equal(rows[0].classification, "warning");
  assert.equal(summary.warning, 1);
});

test("media write-rows: buildMediaCreateInputFromPreviewRow builds valid input", () => {
  const result = buildMediaCreateInputFromPreviewRow({
    editedRow: {
      image_alt: "New hat",
      image_src: "https://example.com/hat.jpg",
    },
    productId: "gid://shopify/Product/1",
  });

  assert.ok(result.ok);
  assert.equal(result.input.originalSource, "https://example.com/hat.jpg");
  assert.equal(result.input.alt, "New hat");
  assert.equal(result.input.mediaContentType, "IMAGE");
  assert.equal(result.input.productId, "gid://shopify/Product/1");
});

test("media write-rows: buildMediaCreateInputFromPreviewRow fails without image_src", () => {
  const result = buildMediaCreateInputFromPreviewRow({
    editedRow: { image_alt: "New hat", image_src: "" },
    productId: "gid://shopify/Product/1",
  });

  assert.ok(!result.ok);
  assert.ok(result.errors.some((error) => error.includes("image_src")));
});

test("media write-rows: buildMediaCreateInputFromPreviewRow rejects non-IMAGE media_content_type", () => {
  const result = buildMediaCreateInputFromPreviewRow({
    editedRow: { image_alt: "New hat", image_src: "https://example.com/hat.jpg", media_content_type: "VIDEO" },
    productId: "gid://shopify/Product/1",
  });

  assert.ok(!result.ok);
  assert.ok(result.errors.some((error) => error.includes("空欄または IMAGE")));
});

test("media write-rows: buildMediaUpdateInputFromPreviewRow builds valid input", () => {
  const result = buildMediaUpdateInputFromPreviewRow({
    changedFields: ["image_alt"],
    editedRow: { image_alt: "Updated alt" },
    mediaId: "gid://shopify/MediaImage/1",
  });

  assert.ok(result.ok);
  assert.equal(result.input.id, "gid://shopify/MediaImage/1");
  assert.equal(result.input.alt, "Updated alt");
});

test("media write-rows: buildMediaUpdateInputFromPreviewRow returns null for position-only changes", () => {
  const result = buildMediaUpdateInputFromPreviewRow({
    changedFields: ["image_position"],
    editedRow: { image_position: "2" },
    mediaId: "gid://shopify/MediaImage/1",
  });

  assert.ok(result.ok);
  assert.equal(result.input, null);
});

test("media write-rows: buildMediaDeleteInputFromPreviewRow builds valid input", () => {
  const result = buildMediaDeleteInputFromPreviewRow({
    mediaId: "gid://shopify/MediaImage/1",
    productId: "gid://shopify/Product/1",
  });

  assert.ok(result.ok);
  assert.deepStrictEqual(result.input.mediaIds, ["gid://shopify/MediaImage/1"]);
  assert.equal(result.input.productId, "gid://shopify/Product/1");
});

test("media write-rows: getWritableMediaPreviewRows filters changed rows only", () => {
  const rows = getWritableMediaPreviewRows([
    { classification: "changed", editedRow: {} },
    { classification: "unchanged", editedRow: {} },
    { classification: "changed", editedRow: {} },
    { classification: "error", editedRow: {} },
  ]);

  assert.equal(rows.length, 2);
});

test("media write-rows: mediaChangedFieldsMatch skips image_src comparison", () => {
  const result = mediaChangedFieldsMatch({
    actualRow: { image_alt: "Alt", image_src: "https://cdn.shopify.com/transformed.jpg" },
    changedFields: ["image_src", "image_alt"],
    expectedRow: { image_alt: "Alt", image_src: "https://example.com/original.jpg" },
  });

  assert.ok(result);
});

test("media write-rows: mediaChangedFieldsMatch treats blank image_position as keep-current-order", () => {
  const result = mediaChangedFieldsMatch({
    actualRow: { image_position: "4" },
    changedFields: ["image_position"],
    expectedRow: { image_position: "" },
  });

  assert.ok(result);
});

test("media write-rows: mediaChangedFieldsMatch detects alt mismatch", () => {
  const result = mediaChangedFieldsMatch({
    actualRow: { image_alt: "Wrong alt" },
    changedFields: ["image_alt"],
    expectedRow: { image_alt: "Expected alt" },
  });

  assert.ok(!result);
});

test("media export excludes non-IMAGE media types", () => {
  const builder = createMediaExportCsvBuilder({
    signingKey: "test-signing-key",
  });
  builder.appendProducts([{
    handle: "hat",
    id: "gid://shopify/Product/1",
    media: {
      nodes: [
        { alt: "Image", id: "m1", image: { url: "https://a.jpg" }, mediaContentType: "IMAGE" },
        { alt: "Video", id: "m2", preview: { image: { url: "https://v.mp4" } }, mediaContentType: "VIDEO" },
        { alt: "3D", id: "m3", preview: { image: { url: "https://m.glb" } }, mediaContentType: "MODEL_3D" },
      ],
    },
  }]);
  const { rowCount } = builder.finalize();
  assert.equal(rowCount, 1);
});

test("readMediaForProducts keeps IMAGE rows and full mixed-media state separately", async () => {
  const result = await readMediaForProducts({
    async graphql(query) {
      if (query.includes("query ProductMediaRead")) {
        return {
          ok: true,
          async json() {
            return {
              data: {
                product: {
                  id: "gid://shopify/Product/1",
                  handle: "hat",
                  updatedAt: "2026-03-15T00:00:00Z",
                  media: {
                    nodes: [
                      {
                        alt: "Front",
                        id: "gid://shopify/MediaImage/1",
                        image: { url: "https://cdn.shopify.com/front.jpg" },
                        mediaContentType: "IMAGE",
                        updatedAt: "2026-03-15T00:00:00Z",
                      },
                      {
                        alt: "Clip",
                        id: "gid://shopify/Video/9",
                        mediaContentType: "VIDEO",
                        preview: { image: { url: "https://cdn.shopify.com/video.jpg" } },
                        updatedAt: "2026-03-15T00:00:00Z",
                      },
                    ],
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
      }

      throw new Error(`unexpected GraphQL query: ${query}`);
    },
  }, ["gid://shopify/Product/1"]);

  assert.equal(result.rowsByKey.size, 1);
  assert.equal(
    result.rowsByKey.get("gid://shopify/Product/1\u001egid://shopify/MediaImage/1").image_position,
    "1",
  );
  assert.deepStrictEqual(result.mediaSetByProduct.get("gid://shopify/Product/1"), [
    {
      image_alt: "Front",
      image_position: "1",
      image_src: "https://cdn.shopify.com/front.jpg",
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
  ]);
});

test("media write-rows: buildMediaReorderMovesForProduct builds moves from position changes", () => {
  const moves = buildMediaReorderMovesForProduct([
    {
      changedFields: ["image_position"],
      editedRow: { image_position: "3" },
      mediaId: "gid://shopify/MediaImage/1",
      productId: "gid://shopify/Product/1",
    },
    {
      changedFields: ["image_alt"],
      editedRow: { image_alt: "new" },
      mediaId: "gid://shopify/MediaImage/2",
      productId: "gid://shopify/Product/1",
    },
  ]);

  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, "gid://shopify/MediaImage/1");
  assert.equal(moves[0].newPosition, 2);
});

test("media write-rows: buildMediaReorderMovesForProduct returns null when no position changes", () => {
  const moves = buildMediaReorderMovesForProduct([
    {
      changedFields: ["image_alt"],
      editedRow: { image_alt: "new" },
      mediaId: "gid://shopify/MediaImage/1",
    },
  ]);

  assert.equal(moves, null);
});

test("media write-rows: buildMediaReorderMovesForProduct keeps original position for replace rows", () => {
  const moves = buildMediaReorderMovesForProduct([
    {
      changedFields: ["image_src"],
      editedRow: { image_position: "4" },
      mediaId: "gid://shopify/MediaImage/9",
      operation: "replace",
      productId: "gid://shopify/Product/1",
    },
  ]);

  assert.deepStrictEqual(moves, [{
    id: "gid://shopify/MediaImage/9",
    newPosition: 3,
  }]);
});

test("media write-rows: buildMediaReorderMovesForProduct uses pre-write position for replace rows with blank image_position", () => {
  const moves = buildMediaReorderMovesForProduct([
    {
      changedFields: ["image_src"],
      currentRow: { image_position: "2" },
      editedRow: { image_position: "" },
      mediaId: "gid://shopify/MediaImage/9",
      operation: "replace",
      preWriteRow: { image_position: "2" },
      productId: "gid://shopify/Product/1",
    },
  ]);

  assert.deepStrictEqual(moves, [{
    id: "gid://shopify/MediaImage/9",
    newPosition: 1,
  }]);
});

test("ADR-0014 exists and is accepted", () => {
  const adr = new URL("../../adr/0014-product-media-profile-and-write-contract.md", import.meta.url);
  const content = new URL(adr).pathname;
  assert.ok(content.includes("0014"));
});

test("media preview rejects invalid image_src (not a URL)", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Alt,1,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,not-a-url,Alt,1,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const currentRowsByKey = new Map([
    ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
      image_alt: "Alt",
      image_position: "1",
      image_src: "https://a.jpg",
      media_content_type: "IMAGE",
      media_id: "gid://shopify/MediaImage/1",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-15T00:00:00Z",
    }],
  ]);

  const { rows } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey,
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.ok(rows[0].messages.some((msg) => msg.includes("HTTPS")));
});

test("media preview rejects http:// image_src (insecure)", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Alt,1,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,http://insecure.com/a.jpg,Alt,1,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const currentRowsByKey = new Map([
    ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
      image_alt: "Alt",
      image_position: "1",
      image_src: "https://a.jpg",
      media_content_type: "IMAGE",
      media_id: "gid://shopify/MediaImage/1",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-15T00:00:00Z",
    }],
  ]);

  const { rows } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey,
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.ok(rows[0].messages.some((msg) => msg.includes("HTTPS")));
});

test("media preview rejects invalid image_position", () => {
  const header = PRODUCT_MEDIA_EXPORT_HEADERS.join(",");
  const baselineCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Alt,1,2026-03-15T00:00:00Z\n`;
  const editedCsv = `${header}\ngid://shopify/Product/1,hat,gid://shopify/MediaImage/1,IMAGE,https://a.jpg,Alt,-1,2026-03-15T00:00:00Z\n`;

  const baselineRows = parseMediaPreviewCsv(baselineCsv);
  const editedRows = parseMediaPreviewCsv(editedCsv);
  const {
    placeholderRowsByProductId: baselinePlaceholderRowsByProductId,
    productIds: baselineProductIds,
    rowsByKey: baselineRowsByKey,
  } = indexBaselineMediaRows(baselineRows);

  const currentRowsByKey = new Map([
    ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
      image_alt: "Alt",
      image_position: "1",
      image_src: "https://a.jpg",
      media_content_type: "IMAGE",
      media_id: "gid://shopify/MediaImage/1",
      product_handle: "hat",
      product_id: "gid://shopify/Product/1",
      updated_at: "2026-03-15T00:00:00Z",
    }],
  ]);

  const { rows } = buildMediaPreviewRows({
    baselinePlaceholderRowsByProductId,
    baselineProductIds,
    baselineRowsByKey,
    currentRowsByKey,
    editedRows,
  });

  assert.equal(rows[0].classification, "error");
  assert.ok(rows[0].messages.some((msg) => msg.includes("1 以上の整数")));
});
