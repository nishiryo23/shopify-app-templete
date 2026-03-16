import { sha256Hex } from "../provenance/signing.mjs";
import {
  buildHandleRedirectMetadata,
  isValidProductHandle,
  isHandleChangedFieldSet,
  normalizeProductHandle,
  removeAlreadyAppliedHandleField,
} from "./redirects.mjs";
import { PRODUCT_CORE_SEO_EXPORT_HEADERS } from "./export-profile.mjs";

const EDITABLE_HEADERS = PRODUCT_CORE_SEO_EXPORT_HEADERS.filter((header) => header !== "updated_at");

function normalizeCsv(csvText) {
  return csvText.replace(/\r\n/g, "\n");
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
    actual.length !== PRODUCT_CORE_SEO_EXPORT_HEADERS.length ||
    actual.some((value, index) => value !== PRODUCT_CORE_SEO_EXPORT_HEADERS[index])
  ) {
    throw new Error("CSV header must exactly match product-core-seo-v1");
  }
}

function buildRowObject(cells) {
  const row = {};
  for (let index = 0; index < PRODUCT_CORE_SEO_EXPORT_HEADERS.length; index += 1) {
    row[PRODUCT_CORE_SEO_EXPORT_HEADERS[index]] = cells[index] ?? "";
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

function diffChangedFields(baselineRow, editedRow) {
  const changedFields = [];

  for (const header of EDITABLE_HEADERS) {
    const baselineValue = header === "handle"
      ? normalizeProductHandle(baselineRow?.[header])
      : (baselineRow?.[header] ?? "");
    const editedValue = header === "handle"
      ? normalizeProductHandle(editedRow?.[header])
      : (editedRow?.[header] ?? "");

    if (baselineValue !== editedValue) {
      changedFields.push(header);
    }
  }

  return changedFields;
}

function rowsEqual(leftRow, rightRow) {
  return PRODUCT_CORE_SEO_EXPORT_HEADERS.every(
    (header) => (leftRow?.[header] ?? "") === (rightRow?.[header] ?? ""),
  );
}

export function parseProductPreviewCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    throw new Error("CSV must include a header row");
  }

  assertHeader(rows[0]);

  const parsedRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== PRODUCT_CORE_SEO_EXPORT_HEADERS.length) {
      throw new Error(`CSV row ${index + 1} must contain ${PRODUCT_CORE_SEO_EXPORT_HEADERS.length} columns`);
    }

    parsedRows.push({
      row: buildRowObject(cells),
      rowNumber: index + 1,
    });
  }

  return parsedRows;
}

export function indexRowsByProductId(parsedRows) {
  const rowsByProductId = new Map();

  for (const entry of parsedRows) {
    const productId = entry.row.product_id;
    if (rowsByProductId.has(productId)) {
      throw new Error(`Duplicate product_id detected: ${productId}`);
    }

    rowsByProductId.set(productId, entry);
  }

  return rowsByProductId;
}

export function buildPreviewDigest({
  baselineDigest,
  editedDigest,
  exportJobId,
  profile,
  rows,
  summary,
}) {
  const canonicalPreviewPayload = {
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
      nextHandle: row.nextHandle ?? null,
      productId: row.productId,
      previousHandle: row.previousHandle ?? null,
      redirectAction: row.redirectAction ?? null,
      redirectPath: row.redirectPath ?? null,
      redirectTarget: row.redirectTarget ?? null,
    })),
    summary: stableSortObject(summary),
  };

  return sha256Hex(JSON.stringify(canonicalPreviewPayload));
}

export function buildPreviewRows({
  baselineRowsByProductId,
  currentRowsByProductId,
  currentRedirectsByPath = new Map(),
  editedRows,
}) {
  const rows = [];
  const summary = {
    changed: 0,
    error: 0,
    total: editedRows.length,
    unchanged: 0,
    warning: 0,
  };

  for (const editedEntry of editedRows) {
    const productId = editedEntry.row.product_id;
    const baselineEntry = baselineRowsByProductId.get(productId);
    const currentRow = currentRowsByProductId.get(productId) ?? null;
    const diffedChangedFields = diffChangedFields(baselineEntry?.row ?? null, editedEntry.row);
    const changedFields = removeAlreadyAppliedHandleField(
      diffedChangedFields,
      {
        editedRow: editedEntry.row,
        liveRow: currentRow,
      },
    );
    const isHandleChangeRow = isHandleChangedFieldSet(changedFields);
    const handleAlreadyApplied = isHandleChangedFieldSet(diffedChangedFields) && !isHandleChangeRow;
    const handleRedirect = buildHandleRedirectMetadata({
      baselineRow: currentRow ?? baselineEntry?.row ?? null,
      editedRow: editedEntry.row,
    });
    const messages = [];
    let classification = "changed";

    if (!productId) {
      classification = "error";
      messages.push("product_id is required");
    } else if (!baselineEntry) {
      classification = "error";
      messages.push("product_id was not present in the selected export baseline");
    } else if (!currentRow) {
      classification = "error";
      messages.push("Live Shopify product could not be found");
    } else if (editedEntry.row.updated_at !== baselineEntry.row.updated_at) {
      classification = "error";
      messages.push("updated_at is read-only and must match the baseline export");
    } else {
      const stale = !rowsEqual(currentRow, baselineEntry.row);
      const unchanged = changedFields.length === 0;

      if (handleAlreadyApplied && stale) {
        classification = "warning";
        messages.push("Live Shopify product already matches the edited handle");
      } else if (isHandleChangeRow && !isValidProductHandle(editedEntry.row.handle)) {
        classification = "error";
        messages.push("handle must match Shopify's letters-numbers-hyphens contract");
      } else if (isHandleChangeRow && (!handleRedirect.previousHandle || !handleRedirect.nextHandle)) {
        classification = "error";
        messages.push("handle changes require both baseline and edited handles");
      } else if (isHandleChangeRow && (currentRedirectsByPath.get(handleRedirect.redirectPath)?.length ?? 0) > 0) {
        classification = "error";
        messages.push("A live redirect already exists for the previous product handle");
      } else if (stale) {
        classification = "warning";
        messages.push("Live Shopify product changed after the selected export baseline");
      } else if (unchanged) {
        classification = "unchanged";
      }
    }

    summary[classification] += 1;

    rows.push({
      baselineRow: baselineEntry?.row ?? null,
      changedFields,
      classification,
      currentRow,
      editedRow: editedEntry.row,
      editedRowNumber: editedEntry.rowNumber,
      messages,
      nextHandle: isHandleChangeRow ? handleRedirect.nextHandle : null,
      productId,
      previousHandle: isHandleChangeRow ? handleRedirect.previousHandle : null,
      redirectAction: isHandleChangeRow ? "create" : null,
      redirectPath: isHandleChangeRow ? handleRedirect.redirectPath : null,
      redirectTarget: isHandleChangeRow ? handleRedirect.redirectTarget : null,
      sourceRowNumber: baselineEntry?.rowNumber ?? null,
    });
  }

  return {
    rows,
    summary,
  };
}
