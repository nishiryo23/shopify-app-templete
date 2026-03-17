import {
  PRODUCT_CORE_SEO_EXPORT_HEADERS,
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_EXPORT_FORMAT,
  PRODUCT_EXPORT_XLSX_FORMAT,
  PRODUCT_INVENTORY_EXPORT_HEADERS,
  PRODUCT_INVENTORY_EXPORT_PROFILE,
  PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS,
  PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE,
  PRODUCT_METAFIELDS_EXPORT_HEADERS,
  PRODUCT_METAFIELDS_EXPORT_PROFILE,
  PRODUCT_MEDIA_EXPORT_HEADERS,
  PRODUCT_MEDIA_EXPORT_PROFILE,
  PRODUCT_VARIANT_PRICES_EXPORT_HEADERS,
  PRODUCT_VARIANT_PRICES_EXPORT_PROFILE,
  PRODUCT_VARIANTS_EXPORT_HEADERS,
  PRODUCT_VARIANTS_EXPORT_PROFILE,
} from "./export-profile.mjs";
import { buildEditedRowMapDigest } from "./edited-row-map.mjs";
import { buildRowObject, parseCsvRows, serializeCsvRows } from "../spreadsheets/csv.mjs";
import { readStrictXlsxWorksheetRows } from "../spreadsheets/xlsx.mjs";

const MATRIXIFY_PRODUCTS_SHEET = "Products";
const MATRIXIFY_INVENTORY_SHEET = "Inventory Levels";
const MATRIXIFY_METAFIELDS_SHEET = "Metafields";
const MATRIXIFY_NOOP_COLLECTION_UPDATED_AT = "__matrixify_noop__";
const MATRIXIFY_INVALID_MEDIA_CONTENT_TYPE = "__matrixify_invalid__";
const MATRIXIFY_SUPPORTED_METAFIELD_TYPES = new Set([
  "single_line_text_field",
  "multi_line_text_field",
  "boolean",
  "number_integer",
  "number_decimal",
]);

const MATRIXIFY_PROFILE_CONFIGS = Object.freeze({
  [PRODUCT_CORE_SEO_EXPORT_PROFILE]: {
    allowedHeaders: [
      "ID",
      "Handle",
      "Title",
      "Status",
      "Vendor",
      "Type",
      "Tags",
      "Body HTML",
      "Metafield: title_tag",
      "Metafield: description_tag",
    ],
    canonicalHeaders: PRODUCT_CORE_SEO_EXPORT_HEADERS,
    requiredHeaders: ["ID"],
    worksheetName: MATRIXIFY_PRODUCTS_SHEET,
  },
  [PRODUCT_VARIANTS_EXPORT_PROFILE]: {
    allowedHeaders: [
      "ID",
      "Handle",
      "Variant ID",
      "Option1 Name",
      "Option1 Value",
      "Option2 Name",
      "Option2 Value",
      "Option3 Name",
      "Option3 Value",
      "Variant SKU",
      "Variant Barcode",
      "Variant Taxable",
      "Variant Requires Shipping",
      "Variant Inventory Policy",
      "Command",
    ],
    canonicalHeaders: PRODUCT_VARIANTS_EXPORT_HEADERS,
    requiredHeaders: ["ID"],
    worksheetName: MATRIXIFY_PRODUCTS_SHEET,
  },
  [PRODUCT_VARIANT_PRICES_EXPORT_PROFILE]: {
    allowedHeaders: [
      "ID",
      "Handle",
      "Variant ID",
      "Option1 Name",
      "Option1 Value",
      "Option2 Name",
      "Option2 Value",
      "Option3 Name",
      "Option3 Value",
      "Variant Price",
      "Variant Compare At Price",
    ],
    canonicalHeaders: PRODUCT_VARIANT_PRICES_EXPORT_HEADERS,
    requiredHeaders: ["ID", "Variant ID"],
    worksheetName: MATRIXIFY_PRODUCTS_SHEET,
  },
  [PRODUCT_INVENTORY_EXPORT_PROFILE]: {
    allowedHeaders: [
      "Variant ID",
      "Location ID",
      "Location",
      "Available",
    ],
    canonicalHeaders: PRODUCT_INVENTORY_EXPORT_HEADERS,
    requiredHeaders: ["Variant ID", "Location ID", "Available"],
    worksheetName: MATRIXIFY_INVENTORY_SHEET,
  },
  [PRODUCT_MEDIA_EXPORT_PROFILE]: {
    allowedHeaders: [
      "ID",
      "Image Src",
      "Image Alt Text",
      "Image Position",
      "Image Command",
    ],
    canonicalHeaders: PRODUCT_MEDIA_EXPORT_HEADERS,
    requiredHeaders: ["ID", "Image Src"],
    worksheetName: MATRIXIFY_PRODUCTS_SHEET,
  },
  [PRODUCT_METAFIELDS_EXPORT_PROFILE]: {
    allowedHeaders: [
      "Owner ID",
      "Owner Handle",
      "Namespace",
      "Key",
      "Type",
      "Value",
    ],
    canonicalHeaders: PRODUCT_METAFIELDS_EXPORT_HEADERS,
    requiredHeaders: ["Owner ID", "Namespace", "Key", "Type", "Value"],
    worksheetName: MATRIXIFY_METAFIELDS_SHEET,
  },
  [PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE]: {
    allowedHeaders: [
      "ID",
      "Handle",
      "Custom Collections",
    ],
    canonicalHeaders: PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS,
    requiredHeaders: ["ID"],
    worksheetName: MATRIXIFY_PRODUCTS_SHEET,
  },
});

function toTrimmedString(value) {
  return String(value ?? "").trim();
}

function normalizeRows(rows) {
  return rows.map((row) => Array.isArray(row) ? row.map((value) => value ?? "") : []);
}

function buildSubsetHeaderMap({ allowedHeaders, headers, profile }) {
  const allowedHeaderSet = new Set(allowedHeaders);
  const duplicateHeaders = [];
  const headerSet = new Set();

  for (const header of headers) {
    if (headerSet.has(header)) {
      duplicateHeaders.push(header);
      continue;
    }
    headerSet.add(header);
    if (!allowedHeaderSet.has(header)) {
      throw new Error(`Unsupported Matrixify header for ${profile}: ${header}`);
    }
  }

  if (duplicateHeaders.length > 0) {
    throw new Error(`Duplicate Matrixify headers for ${profile}: ${duplicateHeaders.join(", ")}`);
  }

  return headerSet;
}

function assertRequiredHeaders({ headerSet, profile, requiredHeaders }) {
  for (const header of requiredHeaders) {
    if (!headerSet.has(header)) {
      throw new Error(`Missing required Matrixify header for ${profile}: ${header}`);
    }
  }
}

function buildParsedRows({ headers, rows }) {
  return rows.slice(1).map((cells, index) => {
    if (cells.length > headers.length) {
      throw new Error(`Matrixify row ${index + 2} contains more columns than the header`);
    }

    return {
      row: buildRowObject(headers, cells),
      rowNumber: index + 2,
    };
  });
}

function parseCanonicalBaseline({ canonicalCsvText, canonicalHeaders, profile }) {
  const rows = parseCsvRows(canonicalCsvText);
  if (rows.length === 0) {
    throw new Error(`Baseline canonical CSV is empty for ${profile}`);
  }

  const headerRow = rows[0] ?? [];
  if (
    headerRow.length !== canonicalHeaders.length
    || headerRow.some((value, index) => value !== canonicalHeaders[index])
  ) {
    throw new Error(`Baseline canonical CSV header mismatch for ${profile}`);
  }

  return rows.slice(1).map((cells, index) => ({
    row: buildRowObject(canonicalHeaders, cells),
    rowNumber: index + 2,
  }));
}

function readOnlyBackfill(value, fallback) {
  return fallback ?? value ?? "";
}

function writableValue({ baselineValue = "", header, headerSet, row }) {
  if (!headerSet.has(header)) {
    return baselineValue ?? "";
  }

  return row[header] ?? "";
}

function buildCanonicalResult({ canonicalHeaders, editedRowNumbers, canonicalRows }) {
  const rows = [canonicalHeaders, ...canonicalRows];
  return {
    canonicalCsvText: serializeCsvRows(rows),
    editedRowMapDigest: buildEditedRowMapDigest(editedRowNumbers),
    editedRowNumbers,
    rowCount: canonicalRows.length,
  };
}

function getConfig(profile) {
  const config = MATRIXIFY_PROFILE_CONFIGS[profile];
  if (!config) {
    throw new Error(`Unsupported Matrixify profile: ${profile}`);
  }
  return config;
}

async function readMatrixifyRows({ body, format, worksheetName }) {
  if (format === PRODUCT_EXPORT_XLSX_FORMAT) {
    return normalizeRows(await readStrictXlsxWorksheetRows({
      body,
      worksheetName,
    }));
  }

  if (format !== PRODUCT_EXPORT_FORMAT) {
    throw new Error(`Unsupported Matrixify format: ${format}`);
  }

  return normalizeRows(parseCsvRows(Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "")));
}

function normalizeCoreSeo({ baselineByProductId, headerSet, rows }) {
  const canonicalRows = [];
  const editedRowNumbers = [];

  for (const entry of rows) {
    const productId = toTrimmedString(entry.row.ID);
    const baselineRow = baselineByProductId.get(productId) ?? null;

    canonicalRows.push([
      productId,
      writableValue({ baselineValue: baselineRow?.handle ?? "", header: "Handle", headerSet, row: entry.row }),
      writableValue({ baselineValue: baselineRow?.title ?? "", header: "Title", headerSet, row: entry.row }),
      writableValue({ baselineValue: baselineRow?.status ?? "", header: "Status", headerSet, row: entry.row }),
      writableValue({ baselineValue: baselineRow?.vendor ?? "", header: "Vendor", headerSet, row: entry.row }),
      writableValue({ baselineValue: baselineRow?.product_type ?? "", header: "Type", headerSet, row: entry.row }),
      writableValue({ baselineValue: baselineRow?.tags ?? "", header: "Tags", headerSet, row: entry.row }),
      writableValue({ baselineValue: baselineRow?.body_html ?? "", header: "Body HTML", headerSet, row: entry.row }),
      writableValue({ baselineValue: baselineRow?.seo_title ?? "", header: "Metafield: title_tag", headerSet, row: entry.row }),
      writableValue({ baselineValue: baselineRow?.seo_description ?? "", header: "Metafield: description_tag", headerSet, row: entry.row }),
      baselineRow?.updated_at ?? "",
    ]);
    editedRowNumbers.push(entry.rowNumber);
  }

  return { canonicalRows, editedRowNumbers };
}

function normalizeVariantCommand(row) {
  const command = toTrimmedString(row.Command).toUpperCase();
  if (!command) {
    return toTrimmedString(row["Variant ID"]) ? "UPDATE" : "CREATE";
  }
  if (command === "UPDATE" || command === "CREATE" || command === "DELETE") {
    return command;
  }
  return "INVALID";
}

function buildBaselineMap(rows, keyBuilder) {
  const map = new Map();
  const rowsByGroup = new Map();

  for (const entry of rows) {
    const key = keyBuilder(entry.row);
    if (key) {
      map.set(key, entry.row);
    }

    const groupKey = toTrimmedString(entry.row.product_id);
    if (groupKey) {
      if (!rowsByGroup.has(groupKey)) {
        rowsByGroup.set(groupKey, []);
      }
      rowsByGroup.get(groupKey).push(entry.row);
    }
  }

  return { map, rowsByGroup };
}

function matrixifyCreateValue({ command, header, headerSet, row, fallback = "" }) {
  if (command === "CREATE" && headerSet.has(header)) {
    return row[header] ?? "";
  }

  return fallback ?? "";
}

function normalizeVariants({ baselineByVariantId, headerSet, rows }) {
  const canonicalRows = [];
  const editedRowNumbers = [];

  for (const entry of rows) {
    const command = normalizeVariantCommand(entry.row);
    const variantId = toTrimmedString(entry.row["Variant ID"]);
    const productId = toTrimmedString(entry.row.ID);
    const baselineRow = command === "CREATE"
      ? null
      : (baselineByVariantId.get(variantId) ?? null);

    canonicalRows.push([
      command,
      productId,
      readOnlyBackfill("", baselineRow?.product_handle ?? ""),
      variantId,
      matrixifyCreateValue({
        command,
        fallback: baselineRow?.option1_name ?? "",
        header: "Option1 Name",
        headerSet,
        row: entry.row,
      }),
      headerSet.has("Option1 Value") ? (entry.row["Option1 Value"] ?? "") : (command === "CREATE" ? "" : (baselineRow?.option1_value ?? "")),
      matrixifyCreateValue({
        command,
        fallback: baselineRow?.option2_name ?? "",
        header: "Option2 Name",
        headerSet,
        row: entry.row,
      }),
      headerSet.has("Option2 Value") ? (entry.row["Option2 Value"] ?? "") : (command === "CREATE" ? "" : (baselineRow?.option2_value ?? "")),
      matrixifyCreateValue({
        command,
        fallback: baselineRow?.option3_name ?? "",
        header: "Option3 Name",
        headerSet,
        row: entry.row,
      }),
      headerSet.has("Option3 Value") ? (entry.row["Option3 Value"] ?? "") : (command === "CREATE" ? "" : (baselineRow?.option3_value ?? "")),
      headerSet.has("Variant SKU") ? (entry.row["Variant SKU"] ?? "") : (command === "CREATE" ? "" : (baselineRow?.sku ?? "")),
      headerSet.has("Variant Barcode") ? (entry.row["Variant Barcode"] ?? "") : (command === "CREATE" ? "" : (baselineRow?.barcode ?? "")),
      headerSet.has("Variant Taxable") ? (entry.row["Variant Taxable"] ?? "") : (command === "CREATE" ? "" : (baselineRow?.taxable ?? "")),
      headerSet.has("Variant Requires Shipping") ? (entry.row["Variant Requires Shipping"] ?? "") : (command === "CREATE" ? "" : (baselineRow?.requires_shipping ?? "")),
      headerSet.has("Variant Inventory Policy") ? (entry.row["Variant Inventory Policy"] ?? "") : (command === "CREATE" ? "" : (baselineRow?.inventory_policy ?? "")),
      command === "CREATE" ? "" : (baselineRow?.updated_at ?? ""),
    ]);
    editedRowNumbers.push(entry.rowNumber);
  }

  return { canonicalRows, editedRowNumbers };
}

function normalizeVariantPrices({ baselineByVariantId, headerSet, rows }) {
  const canonicalRows = [];
  const editedRowNumbers = [];

  for (const entry of rows) {
    const variantId = toTrimmedString(entry.row["Variant ID"]);
    const productId = toTrimmedString(entry.row.ID);
    const baselineRow = baselineByVariantId.get(variantId) ?? null;

    canonicalRows.push([
      productId,
      readOnlyBackfill("", baselineRow?.product_handle ?? ""),
      variantId,
      readOnlyBackfill("", baselineRow?.option1_name ?? ""),
      readOnlyBackfill("", baselineRow?.option1_value ?? ""),
      readOnlyBackfill("", baselineRow?.option2_name ?? ""),
      readOnlyBackfill("", baselineRow?.option2_value ?? ""),
      readOnlyBackfill("", baselineRow?.option3_name ?? ""),
      readOnlyBackfill("", baselineRow?.option3_value ?? ""),
      headerSet.has("Variant Price") ? (entry.row["Variant Price"] ?? "") : (baselineRow?.price ?? ""),
      headerSet.has("Variant Compare At Price") ? (entry.row["Variant Compare At Price"] ?? "") : (baselineRow?.compare_at_price ?? ""),
      baselineRow?.updated_at ?? "",
    ]);
    editedRowNumbers.push(entry.rowNumber);
  }

  return { canonicalRows, editedRowNumbers };
}

function normalizeInventory({ baselineByVariantAndLocation, rows }) {
  const canonicalRows = [];
  const editedRowNumbers = [];

  for (const entry of rows) {
    const variantId = toTrimmedString(entry.row["Variant ID"]);
    const locationId = toTrimmedString(entry.row["Location ID"]);
    const baselineRow = baselineByVariantAndLocation.get(`${variantId}\u001e${locationId}`) ?? null;

    canonicalRows.push([
      baselineRow?.product_id ?? "",
      baselineRow?.product_handle ?? "",
      variantId,
      baselineRow?.option1_name ?? "",
      baselineRow?.option1_value ?? "",
      baselineRow?.option2_name ?? "",
      baselineRow?.option2_value ?? "",
      baselineRow?.option3_name ?? "",
      baselineRow?.option3_value ?? "",
      locationId,
      baselineRow?.location_name ?? "",
      entry.row.Available ?? "",
      baselineRow?.updated_at ?? "",
    ]);
    editedRowNumbers.push(entry.rowNumber);
  }

  return { canonicalRows, editedRowNumbers };
}

function resolveMatrixifyMediaBaselineRow({ baselineRows, imagePosition, imageSrc }) {
  const normalizedSrc = toTrimmedString(imageSrc);
  if (normalizedSrc) {
    const srcMatches = baselineRows.filter((row) => toTrimmedString(row.image_src) === normalizedSrc);
    if (srcMatches.length === 1) {
      return srcMatches[0];
    }
  }

  const normalizedPosition = toTrimmedString(imagePosition);
  if (normalizedPosition) {
    const positionMatches = baselineRows.filter((row) => toTrimmedString(row.image_position) === normalizedPosition);
    if (positionMatches.length === 1) {
      return positionMatches[0];
    }
  }

  return null;
}

function normalizeMedia({ baselineRowsByProductId, headerSet, rows }) {
  const canonicalRows = [];
  const editedRowNumbers = [];

  for (const entry of rows) {
    const imageSrc = toTrimmedString(entry.row["Image Src"]);
    if (!imageSrc) {
      throw new Error(`Matrixify media row ${entry.rowNumber} must include Image Src; delete semantics are unsupported`);
    }

    const productId = toTrimmedString(entry.row.ID);
    const baselineRows = baselineRowsByProductId.get(productId) ?? [];
    const hasExistingBaselineMedia = baselineRows.some(
      (row) => toTrimmedString(row.media_id) || toTrimmedString(row.image_src),
    );
    const baselineRow = resolveMatrixifyMediaBaselineRow({
      baselineRows,
      imagePosition: entry.row["Image Position"],
      imageSrc,
    });
    if (!baselineRow && hasExistingBaselineMedia) {
      throw new Error(
        `Matrixify media row ${entry.rowNumber} could not be matched to a baseline media row; `
        + "ambiguous updates to existing media are unsupported",
      );
    }
    const command = toTrimmedString(entry.row["Image Command"]).toUpperCase();
    const mediaContentType = command === "" || command === "MERGE"
      ? "IMAGE"
      : MATRIXIFY_INVALID_MEDIA_CONTENT_TYPE;

    canonicalRows.push([
      productId,
      baselineRow?.product_handle ?? "",
      baselineRow?.media_id ?? "",
      mediaContentType,
      imageSrc,
      headerSet.has("Image Alt Text") ? (entry.row["Image Alt Text"] ?? "") : (baselineRow?.image_alt ?? ""),
      headerSet.has("Image Position") ? (entry.row["Image Position"] ?? "") : (baselineRow?.image_position ?? ""),
      baselineRow?.updated_at ?? "",
    ]);
    editedRowNumbers.push(entry.rowNumber);
  }

  return { canonicalRows, editedRowNumbers };
}

function normalizeMetafields({ baselineByKey, rows }) {
  const canonicalRows = [];
  const editedRowNumbers = [];

  for (const entry of rows) {
    const productId = toTrimmedString(entry.row["Owner ID"]);
    const namespace = toTrimmedString(entry.row.Namespace);
    const key = toTrimmedString(entry.row.Key);
    const type = toTrimmedString(entry.row.Type);
    const baselineRow = baselineByKey.get(`${productId}\u001e${namespace}\u001e${key}`) ?? null;
    const normalizedType = MATRIXIFY_SUPPORTED_METAFIELD_TYPES.has(type) ? type : type;

    canonicalRows.push([
      productId,
      baselineRow?.product_handle ?? toTrimmedString(entry.row["Owner Handle"]),
      namespace,
      key,
      normalizedType,
      entry.row.Value ?? "",
      baselineRow?.updated_at ?? "",
    ]);
    editedRowNumbers.push(entry.rowNumber);
  }

  return { canonicalRows, editedRowNumbers };
}

function splitCollectionHandles(value) {
  return String(value ?? "")
    .split(/[;,]/)
    .map((item) => item.trim());
}

function normalizeCollectionHandleKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildMatrixifyNoopCollectionRow({ productHandle, productId }) {
  return [
    productId,
    productHandle,
    "",
    "",
    "",
    "",
    MATRIXIFY_NOOP_COLLECTION_UPDATED_AT,
  ];
}

function normalizeCollections({ baselineRowsByProductId, headerSet, rows }) {
  const canonicalRows = [];
  const editedRowNumbers = [];

  for (const entry of rows) {
    const productId = toTrimmedString(entry.row.ID);
    const productHandle = toTrimmedString(entry.row.Handle);
    const baselineRows = baselineRowsByProductId.get(productId) ?? [];
    const baselineMembershipRows = baselineRows.filter((row) => (
      normalizeCollectionHandleKey(row.collection_handle)
      || toTrimmedString(row.collection_id)
      || toTrimmedString(row.collection_title)
      || toTrimmedString(row.membership)
    ));
    const baselineRowsByHandle = new Map(
      baselineMembershipRows
        .filter((row) => normalizeCollectionHandleKey(row.collection_handle))
        .map((row) => [normalizeCollectionHandleKey(row.collection_handle), row]),
    );

    if (!headerSet.has("Custom Collections")) {
      if (baselineMembershipRows.length > 0) {
        for (const baselineRow of baselineMembershipRows) {
          canonicalRows.push([
            productId,
            baselineRow.product_handle ?? productHandle,
            baselineRow.collection_id ?? "",
            baselineRow.collection_handle ?? "",
            baselineRow.collection_title ?? "",
            baselineRow.membership ?? "member",
            baselineRow.updated_at ?? "",
          ]);
          editedRowNumbers.push(entry.rowNumber);
        }
        continue;
      }

      canonicalRows.push([
        ...buildMatrixifyNoopCollectionRow({ productHandle, productId }),
      ]);
      editedRowNumbers.push(entry.rowNumber);
      continue;
    }

    const rawValue = entry.row["Custom Collections"] ?? "";
    const handles = splitCollectionHandles(rawValue);
    const nonEmptyHandles = handles.filter(Boolean);
    const requestedHandles = new Set(nonEmptyHandles.map((handle) => normalizeCollectionHandleKey(handle)));
    const omittedBaselineHandles = [...baselineRowsByHandle.keys()]
      .filter((handle) => !requestedHandles.has(handle));

    if (String(rawValue) === "") {
      if (baselineMembershipRows.length > 0) {
        throw new Error(`Matrixify custom collections row ${entry.rowNumber} cannot clear baseline collections; remove semantics are unsupported`);
      }
      canonicalRows.push(
        buildMatrixifyNoopCollectionRow({
          productHandle: productHandle || baselineRows[0]?.product_handle || "",
          productId,
        }),
      );
      editedRowNumbers.push(entry.rowNumber);
      continue;
    }

    if (nonEmptyHandles.length === 0) {
      if (baselineMembershipRows.length > 0) {
        throw new Error(`Matrixify custom collections row ${entry.rowNumber} cannot clear baseline collections; remove semantics are unsupported`);
      }
      canonicalRows.push(
        buildMatrixifyNoopCollectionRow({
          productHandle: productHandle || baselineRows[0]?.product_handle || "",
          productId,
        }),
      );
      editedRowNumbers.push(entry.rowNumber);
      continue;
    }

    if (omittedBaselineHandles.length > 0) {
      throw new Error(`Matrixify custom collections row ${entry.rowNumber} cannot remove baseline collections; remove semantics are unsupported`);
    }

    for (const handle of nonEmptyHandles) {
      const baselineRow = baselineRowsByHandle.get(normalizeCollectionHandleKey(handle)) ?? null;
      canonicalRows.push([
        productId,
        productHandle || baselineRow?.product_handle || baselineMembershipRows[0]?.product_handle || baselineRows[0]?.product_handle || "",
        baselineRow?.collection_id ?? "",
        baselineRow?.collection_handle ?? handle,
        baselineRow?.collection_title ?? "",
        "member",
        baselineRow?.updated_at ?? "",
      ]);
      editedRowNumbers.push(entry.rowNumber);
    }
  }

  return { canonicalRows, editedRowNumbers };
}

export async function canonicalizeMatrixifyProductSpreadsheet({
  baselineCanonicalCsvText,
  body,
  format,
  profile,
}) {
  const config = getConfig(profile);
  const rows = await readMatrixifyRows({
    body,
    format,
    worksheetName: config.worksheetName,
  });

  if (rows.length === 0) {
    throw new Error("Matrixify spreadsheet must include a header row");
  }

  const headers = rows[0] ?? [];
  const headerSet = buildSubsetHeaderMap({
    allowedHeaders: config.allowedHeaders,
    headers,
    profile,
  });
  assertRequiredHeaders({
    headerSet,
    profile,
    requiredHeaders: config.requiredHeaders,
  });

  const parsedRows = buildParsedRows({ headers, rows });
  const baselineRows = parseCanonicalBaseline({
    canonicalCsvText: baselineCanonicalCsvText,
    canonicalHeaders: config.canonicalHeaders,
    profile,
  });

  if (profile === PRODUCT_CORE_SEO_EXPORT_PROFILE) {
    const baselineByProductId = new Map(baselineRows.map((entry) => [toTrimmedString(entry.row.product_id), entry.row]));
    return buildCanonicalResult({
      canonicalHeaders: PRODUCT_CORE_SEO_EXPORT_HEADERS,
      ...normalizeCoreSeo({ baselineByProductId, headerSet, rows: parsedRows }),
    });
  }

  if (profile === PRODUCT_VARIANTS_EXPORT_PROFILE) {
    const baselineByVariantId = new Map(
      baselineRows
        .filter((entry) => toTrimmedString(entry.row.variant_id))
        .map((entry) => [toTrimmedString(entry.row.variant_id), entry.row]),
    );
    return buildCanonicalResult({
      canonicalHeaders: PRODUCT_VARIANTS_EXPORT_HEADERS,
      ...normalizeVariants({ baselineByVariantId, headerSet, rows: parsedRows }),
    });
  }

  if (profile === PRODUCT_VARIANT_PRICES_EXPORT_PROFILE) {
    const baselineByVariantId = new Map(
      baselineRows
        .filter((entry) => toTrimmedString(entry.row.variant_id))
        .map((entry) => [toTrimmedString(entry.row.variant_id), entry.row]),
    );
    return buildCanonicalResult({
      canonicalHeaders: PRODUCT_VARIANT_PRICES_EXPORT_HEADERS,
      ...normalizeVariantPrices({ baselineByVariantId, headerSet, rows: parsedRows }),
    });
  }

  if (profile === PRODUCT_INVENTORY_EXPORT_PROFILE) {
    const baselineByVariantAndLocation = new Map(
      baselineRows
        .filter((entry) => toTrimmedString(entry.row.variant_id) || toTrimmedString(entry.row.location_id))
        .map((entry) => [`${toTrimmedString(entry.row.variant_id)}\u001e${toTrimmedString(entry.row.location_id)}`, entry.row]),
    );
    return buildCanonicalResult({
      canonicalHeaders: PRODUCT_INVENTORY_EXPORT_HEADERS,
      ...normalizeInventory({ baselineByVariantAndLocation, rows: parsedRows }),
    });
  }

  if (profile === PRODUCT_MEDIA_EXPORT_PROFILE) {
    const { rowsByGroup: baselineRowsByProductId } = buildBaselineMap(
      baselineRows,
      (row) => `${row.product_id ?? ""}\u001e${row.media_id ?? ""}`,
    );
    return buildCanonicalResult({
      canonicalHeaders: PRODUCT_MEDIA_EXPORT_HEADERS,
      ...normalizeMedia({ baselineRowsByProductId, headerSet, rows: parsedRows }),
    });
  }

  if (profile === PRODUCT_METAFIELDS_EXPORT_PROFILE) {
    const baselineByKey = new Map(
      baselineRows.map((entry) => [
        `${toTrimmedString(entry.row.product_id)}\u001e${toTrimmedString(entry.row.namespace)}\u001e${toTrimmedString(entry.row.key)}`,
        entry.row,
      ]),
    );
    return buildCanonicalResult({
      canonicalHeaders: PRODUCT_METAFIELDS_EXPORT_HEADERS,
      ...normalizeMetafields({ baselineByKey, rows: parsedRows }),
    });
  }

  const { rowsByGroup: baselineRowsByProductId } = buildBaselineMap(
    baselineRows,
    (row) => `${row.product_id ?? ""}\u001e${row.collection_id ?? ""}\u001e${row.collection_handle ?? ""}`,
  );
  return buildCanonicalResult({
    canonicalHeaders: PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS,
    ...normalizeCollections({ baselineRowsByProductId, headerSet, rows: parsedRows }),
  });
}

export {
  MATRIXIFY_INVALID_MEDIA_CONTENT_TYPE,
  MATRIXIFY_NOOP_COLLECTION_UPDATED_AT,
  MATRIXIFY_PROFILE_CONFIGS,
};
