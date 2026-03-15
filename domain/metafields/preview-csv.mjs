import { sha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_METAFIELDS_EXPORT_HEADERS } from "../products/export-profile.mjs";

const READ_ONLY_HEADERS = new Set([
  "product_handle",
  "updated_at",
]);

const SUPPORTED_TYPES = Object.freeze([
  "single_line_text_field",
  "multi_line_text_field",
  "boolean",
  "number_integer",
  "number_decimal",
]);

const SUPPORTED_TYPES_SET = new Set(SUPPORTED_TYPES);

function normalizeCsv(csvText) {
  return String(csvText ?? "").replace(/\r\n/g, "\n");
}

function parseCsvRows(csvText) {
  const normalizedCsv = normalizeCsv(csvText);
  const rows = [];
  let currentCell = "";
  let currentRow = [];
  let inQuotes = false;

  for (let index = 0; index < normalizedCsv.length; index += 1) {
    const char = normalizedCsv[index];
    const nextChar = normalizedCsv[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        currentCell += "\"";
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentCell = "";
      currentRow = [];
      continue;
    }

    currentCell += char;
  }

  if (inQuotes) {
    throw new Error("CSV parsing failed: unclosed quoted field");
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

function assertHeader(headerRow) {
  const actual = Array.isArray(headerRow) ? headerRow : [];
  if (
    actual.length !== PRODUCT_METAFIELDS_EXPORT_HEADERS.length
    || actual.some((value, index) => value !== PRODUCT_METAFIELDS_EXPORT_HEADERS[index])
  ) {
    throw new Error("CSV header must exactly match product-metafields-v1");
  }
}

function buildRowObject(cells) {
  const row = {};
  for (let index = 0; index < PRODUCT_METAFIELDS_EXPORT_HEADERS.length; index += 1) {
    row[PRODUCT_METAFIELDS_EXPORT_HEADERS[index]] = cells[index] ?? "";
  }
  return row;
}

function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableSortObject(value[key]);
    return result;
  }, {});
}

export function isSupportedProductMetafieldType(type) {
  return SUPPORTED_TYPES_SET.has(String(type ?? "").trim());
}

export function normalizeMetafieldMultilineValue(value) {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

function isStrictInteger(value) {
  return /^-?\d+$/.test(String(value ?? "").trim());
}

function isStrictDecimal(value) {
  return /^-?\d+(?:\.\d+)?$/.test(String(value ?? "").trim());
}

export function canonicalizeMetafieldCsvValue(type, value) {
  const normalizedType = String(type ?? "").trim();
  const stringValue = String(value ?? "");

  if (normalizedType === "multi_line_text_field") {
    return normalizeMetafieldMultilineValue(stringValue);
  }

  if (normalizedType === "boolean") {
    return stringValue.trim().toLowerCase();
  }

  if (normalizedType === "number_integer") {
    return stringValue.trim();
  }

  if (normalizedType === "number_decimal") {
    return stringValue.trim();
  }

  return stringValue;
}

export function canonicalizeMetafieldStoredValue(type, value) {
  const normalizedType = String(type ?? "").trim();
  const stringValue = String(value ?? "");

  if (normalizedType === "multi_line_text_field") {
    return normalizeMetafieldMultilineValue(stringValue);
  }

  if (normalizedType === "boolean") {
    return stringValue.trim().toLowerCase();
  }

  if (normalizedType === "number_integer") {
    return stringValue.trim();
  }

  if (normalizedType === "number_decimal") {
    return stringValue.trim();
  }

  return stringValue;
}

export function normalizeMetafieldForWrite(type, value) {
  const normalizedType = String(type ?? "").trim();
  const stringValue = String(value ?? "");

  if (normalizedType === "multi_line_text_field") {
    return normalizeMetafieldMultilineValue(stringValue);
  }

  if (normalizedType === "boolean") {
    return stringValue.trim().toLowerCase();
  }

  if (normalizedType === "number_integer") {
    return stringValue.trim();
  }

  if (normalizedType === "number_decimal") {
    return stringValue.trim();
  }

  return stringValue;
}

function validateCanonicalValue(type, value) {
  if (value === "") {
    return "value is required";
  }

  if (!isSupportedProductMetafieldType(type)) {
    return `unsupported metafield type: ${type}`;
  }

  if (type === "boolean" && !["true", "false"].includes(String(value).trim().toLowerCase())) {
    return "boolean metafield value must be true or false";
  }

  if (type === "number_integer" && !isStrictInteger(value)) {
    return "number_integer metafield value must be a signed integer";
  }

  if (type === "number_decimal" && !isStrictDecimal(value)) {
    return "number_decimal metafield value must be a decimal string";
  }

  return null;
}

function buildMetafieldRowKey(row) {
  return `${row?.product_id ?? ""}\u001e${String(row?.namespace ?? "").trim()}\u001e${String(row?.key ?? "").trim()}`;
}

function normalizeComparableRow(row) {
  if (!row) {
    return null;
  }

  const type = String(row.type ?? "").trim();
  return {
    key: String(row.key ?? "").trim(),
    namespace: String(row.namespace ?? "").trim(),
    product_handle: row.product_handle ?? "",
    product_id: row.product_id ?? "",
    type,
    updated_at: row.updated_at ?? "",
    value: canonicalizeMetafieldStoredValue(type, row.value ?? ""),
  };
}

export function parseMetafieldPreviewCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    throw new Error("CSV must include a header row");
  }

  assertHeader(rows[0]);

  const parsedRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== PRODUCT_METAFIELDS_EXPORT_HEADERS.length) {
      throw new Error(`CSV row ${index + 1} must contain ${PRODUCT_METAFIELDS_EXPORT_HEADERS.length} columns`);
    }

    parsedRows.push({
      row: buildRowObject(cells),
      rowNumber: index + 1,
    });
  }

  return parsedRows;
}

export function indexMetafieldRows(parsedRows) {
  const productIds = new Set();
  const rowsByKey = new Map();

  for (const entry of parsedRows) {
    if (entry.row.product_id) {
      productIds.add(entry.row.product_id);
    }

    const key = buildMetafieldRowKey(entry.row);
    if (rowsByKey.has(key)) {
      throw new Error(`Duplicate metafield row detected: ${key}`);
    }

    rowsByKey.set(key, entry);
  }

  return {
    productIds,
    rowsByKey,
  };
}

export function metafieldRowsMatch(leftRow, rightRow) {
  const left = normalizeComparableRow(leftRow);
  const right = normalizeComparableRow(rightRow);

  if (!left || !right) {
    return left === right;
  }

  return left.product_id === right.product_id
    && left.namespace === right.namespace
    && left.key === right.key
    && left.type === right.type
    && left.value === right.value;
}

function diffChangedFields({ currentRow, editedRow, operation }) {
  if (operation === "create") {
    return ["type", "value"];
  }

  const changedFields = [];
  const currentValue = canonicalizeMetafieldStoredValue(currentRow?.type ?? "", currentRow?.value ?? "");
  const editedValue = canonicalizeMetafieldStoredValue(editedRow?.type ?? "", editedRow?.value ?? "");

  if ((currentRow?.type ?? "") !== (editedRow?.type ?? "")) {
    changedFields.push("type");
  }

  if (currentValue !== editedValue) {
    changedFields.push("value");
  }

  return changedFields;
}

function buildSummary(rows) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    summary[row.classification] += 1;
    return summary;
  }, {
    changed: 0,
    error: 0,
    total: 0,
    unchanged: 0,
    warning: 0,
  });
}

function validateReadOnlyColumns({ baselineRow, currentRow, editedRow, messages, productRow }) {
  const referenceRow = baselineRow ?? currentRow ?? productRow ?? null;
  if (!referenceRow) {
    return;
  }

  for (const header of READ_ONLY_HEADERS) {
    const baselineValue = referenceRow?.[header] ?? "";
    if (baselineValue !== (editedRow?.[header] ?? "")) {
      messages.push(`${header} is read-only and must match the current Shopify row`);
    }
  }
}

function validateRequiredFields(editedRow, messages) {
  if (!String(editedRow?.product_id ?? "").trim()) {
    messages.push("product_id is required");
  }

  if (!String(editedRow?.namespace ?? "").trim()) {
    messages.push("namespace is required");
  }

  if (!String(editedRow?.key ?? "").trim()) {
    messages.push("key is required");
  }

  if (!String(editedRow?.type ?? "").trim()) {
    messages.push("type is required");
  }

  const canonicalError = validateCanonicalValue(
    String(editedRow?.type ?? "").trim(),
    canonicalizeMetafieldCsvValue(editedRow?.type ?? "", editedRow?.value ?? ""),
  );
  if (canonicalError) {
    messages.push(canonicalError);
  }
}

export function buildMetafieldPreviewRows({
  baselineRowsByKey,
  currentRowsByKey,
  editedRows,
  existingProductIds = new Set(),
  productRowsById = new Map(),
}) {
  const rows = [];

  for (const entry of editedRows) {
    const editedRow = {
      ...entry.row,
      key: String(entry.row.key ?? "").trim(),
      namespace: String(entry.row.namespace ?? "").trim(),
      type: String(entry.row.type ?? "").trim(),
      value: canonicalizeMetafieldCsvValue(entry.row.type ?? "", entry.row.value ?? ""),
    };
    const key = buildMetafieldRowKey(editedRow);
    const baselineEntry = baselineRowsByKey.get(key) ?? null;
    const baselineRow = baselineEntry?.row
      ? normalizeComparableRow(baselineEntry.row)
      : null;
    const currentRow = normalizeComparableRow(currentRowsByKey.get(key) ?? null);
    const productRow = productRowsById.get(editedRow.product_id) ?? null;
    const messages = [];

    validateRequiredFields(editedRow, messages);
    validateReadOnlyColumns({ baselineRow, currentRow, editedRow, messages, productRow });

    const hasBaseline = Boolean(baselineRow);
    const hasCurrent = Boolean(currentRow);
    const productExists = existingProductIds.has(editedRow.product_id);

    if (hasCurrent && currentRow.type !== editedRow.type) {
      messages.push(`type mismatch for existing metafield: ${currentRow.type}`);
    }

    if (!hasCurrent && !productExists) {
      messages.push("owner product does not exist in Shopify");
    }

    let classification = "unchanged";
    let operation = hasCurrent ? "update" : "create";
    let changedFields = [];

    if (messages.length > 0) {
      classification = "error";
    } else if (hasBaseline && !metafieldRowsMatch(baselineRow, currentRow)) {
      classification = "warning";
      operation = "update";
      messages.push("Live Shopify metafield changed after the selected export baseline");
    } else if (!hasBaseline && hasCurrent) {
      classification = "warning";
      operation = "update";
      messages.push("Live Shopify metafield was created after the selected export baseline");
    } else {
      changedFields = diffChangedFields({ currentRow, editedRow, operation });
      classification = changedFields.length > 0 ? "changed" : "unchanged";
    }

    rows.push({
      baselineRow,
      changedFields,
      classification,
      currentRow,
      editedRow,
      editedRowNumber: entry.rowNumber,
      key: editedRow.key,
      messages,
      namespace: editedRow.namespace,
      operation,
      productId: editedRow.product_id,
      sourceRowNumber: baselineEntry?.rowNumber ?? null,
      type: editedRow.type,
    });
  }

  return {
    rows,
    summary: buildSummary(rows),
  };
}

export function buildMetafieldPreviewDigest({
  baselineDigest,
  editedDigest,
  exportJobId,
  profile,
  rows,
  summary,
}) {
  return sha256Hex(JSON.stringify({
    baselineDigest,
    editedDigest,
    exportJobId,
    profile,
    rows: rows.map((row) => ({
      baselineRow: stableSortObject(row.baselineRow),
      changedFields: [...row.changedFields],
      classification: row.classification,
      currentRow: stableSortObject(row.currentRow),
      editedRow: stableSortObject(row.editedRow),
      editedRowNumber: row.editedRowNumber,
      key: row.key,
      namespace: row.namespace,
      operation: row.operation,
      productId: row.productId,
      sourceRowNumber: row.sourceRowNumber,
      type: row.type,
    })),
    summary: stableSortObject(summary),
  }));
}

export function getSupportedProductMetafieldTypes() {
  return [...SUPPORTED_TYPES];
}
