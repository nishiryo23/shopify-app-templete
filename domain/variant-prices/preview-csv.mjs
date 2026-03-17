import { sha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_VARIANT_PRICES_EXPORT_HEADERS } from "../products/export-profile.mjs";
import { canonicalizeMoney, moneyValuesEqual, validateMoneyValue } from "./money.mjs";

const READ_ONLY_HEADERS = new Set([
  "variant_id",
  "product_handle",
  "option1_name",
  "option1_value",
  "option2_name",
  "option2_value",
  "option3_name",
  "option3_value",
  "updated_at",
]);

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
    actual.length !== PRODUCT_VARIANT_PRICES_EXPORT_HEADERS.length
    || actual.some((value, index) => value !== PRODUCT_VARIANT_PRICES_EXPORT_HEADERS[index])
  ) {
    throw new Error("CSV header must exactly match product-variants-prices-v1");
  }
}

function buildRowObject(cells) {
  const row = {};
  for (let index = 0; index < PRODUCT_VARIANT_PRICES_EXPORT_HEADERS.length; index += 1) {
    row[PRODUCT_VARIANT_PRICES_EXPORT_HEADERS[index]] = cells[index] ?? "";
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

function validateReadOnlyColumns({ baselineRow, editedRow, messages }) {
  for (const header of READ_ONLY_HEADERS) {
    if ((baselineRow?.[header] ?? "") !== (editedRow?.[header] ?? "")) {
      messages.push(`${header} is read-only and must match the export baseline`);
    }
  }
}

function validateMoneyColumns(editedRow, changedFields, messages) {
  for (const field of ["price", "compare_at_price"]) {
    const validation = validateMoneyValue(editedRow?.[field], field);
    if (!validation.valid) {
      messages.push(validation.error);
    }
  }

  if (changedFields.includes("price") && !String(editedRow?.price ?? "").trim()) {
    messages.push("price cannot be blank when changed");
  }
}

function diffChangedFields(baselineRow, editedRow) {
  const changedFields = [];

  for (const header of ["price", "compare_at_price"]) {
    if (!moneyValuesEqual(baselineRow?.[header], editedRow?.[header])) {
      changedFields.push(header);
    }
  }

  return changedFields;
}

export function parseVariantPricePreviewCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    throw new Error("CSV must include a header row");
  }

  assertHeader(rows[0]);

  const parsedRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== PRODUCT_VARIANT_PRICES_EXPORT_HEADERS.length) {
      throw new Error(`CSV row ${index + 1} must contain ${PRODUCT_VARIANT_PRICES_EXPORT_HEADERS.length} columns`);
    }

    parsedRows.push({
      row: buildRowObject(cells),
      rowNumber: index + 1,
    });
  }

  return parsedRows;
}

export function indexVariantPriceRows(parsedRows) {
  const rowsByVariantId = new Map();
  const productIds = new Set();

  for (const entry of parsedRows) {
    const variantId = entry?.row?.variant_id ?? "";
    if (!variantId) {
      continue;
    }

    if (rowsByVariantId.has(variantId)) {
      throw new Error(`Duplicate variant_id detected: ${variantId}`);
    }

    rowsByVariantId.set(variantId, entry);
    if (entry.row.product_id) {
      productIds.add(entry.row.product_id);
    }
  }

  return {
    productIds,
    rowsByVariantId,
  };
}

export function variantPriceRowsMatch(leftRow, rightRow) {
  return PRODUCT_VARIANT_PRICES_EXPORT_HEADERS.every((header) => {
    if (header === "price" || header === "compare_at_price") {
      return moneyValuesEqual(leftRow?.[header], rightRow?.[header]);
    }

    return (leftRow?.[header] ?? "") === (rightRow?.[header] ?? "");
  });
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

export function buildVariantPricePreviewRows({
  baselineRowsByVariantId,
  currentVariantsByProductId,
  editedRows,
}) {
  const rows = editedRows.map((entry) => {
    const editedRow = entry.row;
    const sourceEntry = editedRow.variant_id
      ? (baselineRowsByVariantId.get(editedRow.variant_id) ?? null)
      : null;
    const baselineRow = sourceEntry?.row ?? null;
    const sourceRowNumber = sourceEntry?.rowNumber ?? null;
    const variantId = editedRow.variant_id || null;
    const productId = baselineRow?.product_id || editedRow.product_id || null;
    const currentVariants = productId ? (currentVariantsByProductId.get(productId) ?? []) : [];
    const currentRow = variantId
      ? (currentVariants.find((variant) => variant.variant_id === variantId) ?? null)
      : null;
    const messages = [];
    const changedFields = baselineRow ? diffChangedFields(baselineRow, editedRow) : [];
    let classification = "changed";

    if (!productId) {
      classification = "error";
      messages.push("product_id is required");
    } else if (!variantId) {
      classification = "error";
      messages.push("variant_id is required");
    } else if (!baselineRow) {
      classification = "error";
      messages.push("variant_id was not present in the selected export baseline");
    } else if ((editedRow.product_id || "") !== productId) {
      classification = "error";
      messages.push("product_id must match the product that owns the baseline variant");
    } else if (!currentRow) {
      classification = "error";
      messages.push("Live Shopify variant could not be found");
    } else if (currentRow.product_id !== productId) {
      classification = "error";
      messages.push("product_id must match the product that owns the live variant");
    } else {
      validateReadOnlyColumns({ baselineRow, editedRow, messages });
      validateMoneyColumns(editedRow, changedFields, messages);

      if (messages.length > 0) {
        classification = "error";
      } else if (!variantPriceRowsMatch(currentRow, baselineRow)) {
        classification = "warning";
        messages.push("Live Shopify variant changed after the selected export baseline");
      } else if (changedFields.length === 0) {
        classification = "unchanged";
      }
    }

    return {
      baselineRow,
      changedFields,
      classification,
      currentRow,
      editedRow,
      editedRowNumber: entry.rowNumber,
      messages,
      operation: "update",
      productId,
      sourceRowNumber,
      variantId,
    };
  });

  return {
    rows,
    summary: buildSummary(rows),
  };
}

export function buildVariantPricePreviewDigest({
  baselineDigest,
  editedDigest,
  editedLayout = "canonical",
  editedRowMapDigest = "none",
  exportJobId,
  profile,
  rows,
  summary,
}) {
  return sha256Hex(JSON.stringify({
    baselineDigest,
    editedDigest,
    editedLayout,
    editedRowMapDigest,
    exportJobId,
    profile,
    rows: rows.map((row) => ({
      baselineRow: stableSortObject(row.baselineRow),
      changedFields: [...row.changedFields],
      classification: row.classification,
      currentRow: stableSortObject(row.currentRow),
      editedRow: stableSortObject({
        ...row.editedRow,
        compare_at_price: canonicalizeMoney(row.editedRow?.compare_at_price) ?? row.editedRow?.compare_at_price,
        price: canonicalizeMoney(row.editedRow?.price) ?? row.editedRow?.price,
      }),
      editedRowNumber: row.editedRowNumber,
      operation: row.operation,
      productId: row.productId,
      sourceRowNumber: row.sourceRowNumber,
      variantId: row.variantId,
    })),
    summary: stableSortObject(summary),
  }));
}
