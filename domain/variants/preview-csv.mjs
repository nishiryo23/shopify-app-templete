import { sha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_VARIANTS_EXPORT_HEADERS } from "../products/export-profile.mjs";

const READ_ONLY_HEADERS = new Set([
  "product_handle",
  "option1_name",
  "option2_name",
  "option3_name",
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
    actual.length !== PRODUCT_VARIANTS_EXPORT_HEADERS.length
    || actual.some((value, index) => value !== PRODUCT_VARIANTS_EXPORT_HEADERS[index])
  ) {
    throw new Error("CSV header must exactly match product-variants-v1");
  }
}

function buildRowObject(cells) {
  const row = {};
  for (let index = 0; index < PRODUCT_VARIANTS_EXPORT_HEADERS.length; index += 1) {
    row[PRODUCT_VARIANTS_EXPORT_HEADERS[index]] = cells[index] ?? "";
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

function normalizeCommand(value) {
  const command = String(value ?? "").trim().toUpperCase();
  if (!command || command === "UPDATE") {
    return "UPDATE";
  }

  if (command === "CREATE" || command === "DELETE") {
    return command;
  }

  return "INVALID";
}

export function buildVariantOptionTuple(row) {
  return [row?.option1_value ?? "", row?.option2_value ?? "", row?.option3_value ?? ""].join("\u001f");
}

function buildRowKey(row) {
  return [
    row?.product_id ?? "",
    row?.variant_id ?? "",
    normalizeCommand(row?.command),
    buildVariantOptionTuple(row),
  ].join("\u001e");
}

function diffChangedFields(baselineRow, editedRow) {
  const changedFields = [];

  for (const header of PRODUCT_VARIANTS_EXPORT_HEADERS) {
    if (header === "variant_id" || header === "product_id" || header === "product_handle") {
      continue;
    }

    if ((baselineRow?.[header] ?? "") !== (editedRow?.[header] ?? "")) {
      changedFields.push(header);
    }
  }

  return changedFields;
}

export function parseVariantPreviewCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    throw new Error("CSV must include a header row");
  }

  assertHeader(rows[0]);

  const parsedRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== PRODUCT_VARIANTS_EXPORT_HEADERS.length) {
      throw new Error(`CSV row ${index + 1} must contain ${PRODUCT_VARIANTS_EXPORT_HEADERS.length} columns`);
    }

    parsedRows.push({
      row: buildRowObject(cells),
      rowNumber: index + 1,
    });
  }

  return parsedRows;
}

export function indexVariantRows(parsedRows) {
  const rowsByKey = new Map();
  const productIds = new Set();
  const createTuples = new Set();

  for (const entry of parsedRows) {
    const row = entry.row;
    const command = normalizeCommand(row.command);
    const key = buildRowKey(row);
    if (rowsByKey.has(key)) {
      throw new Error(`Duplicate variant row detected: ${key}`);
    }

    rowsByKey.set(key, entry);
    if (row.product_id) {
      productIds.add(row.product_id);
    }

    if ((command === "CREATE" || command === "UPDATE") && row.product_id) {
      const tupleKey = `${row.product_id}\u001d${buildVariantOptionTuple(row)}`;
      if (createTuples.has(tupleKey)) {
        throw new Error(`Duplicate product_id + option tuple detected: ${row.product_id}`);
      }
      createTuples.add(tupleKey);
    }
  }

  return {
    productIds,
    rowsByKey,
  };
}

function normalizeBooleanString(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function buildVariantPreviewDigest({
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
      createdVariantId: row.createdVariantId ?? null,
      currentRow: stableSortObject(row.currentRow),
      editedRow: stableSortObject(row.editedRow),
      editedRowNumber: row.editedRowNumber,
      operation: row.operation,
      productId: row.productId,
      sourceRowNumber: row.sourceRowNumber,
      variantId: row.variantId,
    })),
    summary: stableSortObject(summary),
  }));
}

function rowsEqual(leftRow, rightRow) {
  return PRODUCT_VARIANTS_EXPORT_HEADERS.every((header) => {
    if (header === "command") {
      return normalizeCommand(leftRow?.command) === normalizeCommand(rightRow?.command);
    }

    if (header === "taxable" || header === "requires_shipping") {
      return normalizeBooleanString(leftRow?.[header]) === normalizeBooleanString(rightRow?.[header]);
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

function validateReadOnlyColumns({ baselineRow, editedRow, messages }) {
  for (const header of READ_ONLY_HEADERS) {
    if ((baselineRow?.[header] ?? "") !== (editedRow?.[header] ?? "")) {
      messages.push(`${header} is read-only and must match the export baseline`);
    }
  }
}

function validateCreateOptionNames({ currentProduct, editedRow, messages }) {
  const optionsByPosition = new Map(
    (currentProduct?.options ?? []).map((option) => [Number(option.position), option?.name ?? ""]),
  );

  for (let index = 1; index <= 3; index += 1) {
    const editedOptionName = editedRow[`option${index}_name`] ?? "";
    const editedOptionValue = editedRow[`option${index}_value`] ?? "";
    const liveOptionName = optionsByPosition.get(index) ?? "";

    if (!editedOptionName && !editedOptionValue) {
      continue;
    }

    if (!liveOptionName) {
      messages.push(`option${index}_name must match the live product option name`);
      continue;
    }

    if (editedOptionName !== liveOptionName) {
      messages.push(`option${index}_name must match the live product option name`);
    }
  }
}

export function buildVariantPreviewRows({
  baselineProductIds,
  baselineRowsByVariantId,
  currentProductsById,
  currentVariantsByProductId,
  editedRows,
}) {
  const rows = editedRows.map((entry) => {
    const editedRow = entry.row;
    const command = normalizeCommand(editedRow.command);
    const variantId = editedRow.variant_id || null;
    const productId = editedRow.product_id || null;
    const baselineRow = variantId ? (baselineRowsByVariantId.get(variantId)?.row ?? null) : null;
    const sourceRowNumber = variantId ? (baselineRowsByVariantId.get(variantId)?.rowNumber ?? null) : null;
    const currentProduct = productId ? (currentProductsById.get(productId) ?? null) : null;
    const currentVariants = productId ? (currentVariantsByProductId.get(productId) ?? []) : [];
    const currentRow = variantId
      ? (currentVariants.find((variant) => variant.variant_id === variantId) ?? null)
      : null;
    const messages = [];
    const changedFields = baselineRow ? diffChangedFields(baselineRow, editedRow) : [];
    let classification = "changed";
    let operation = command.toLowerCase();

    if (!productId) {
      classification = "error";
      messages.push("product_id is required");
    } else if (!baselineProductIds.has(productId)) {
      classification = "error";
      messages.push("product_id was not present in the selected export baseline");
    } else if (command === "INVALID") {
      classification = "error";
      messages.push("command must be CREATE, UPDATE, DELETE, or blank");
    } else if (!currentProduct) {
      classification = "error";
      messages.push("Live Shopify product could not be found");
    } else if (command === "CREATE") {
      operation = "create";
      if (variantId) {
        classification = "error";
        messages.push("variant_id must be blank for CREATE");
      }
      if (editedRow.updated_at) {
        classification = "error";
        messages.push("updated_at must be blank for CREATE");
      }
      if (!buildVariantOptionTuple(editedRow)) {
        classification = "error";
        messages.push("at least one option value is required for CREATE");
      }
      validateCreateOptionNames({ currentProduct, editedRow, messages });

      const duplicateLive = currentVariants.find(
        (variant) => buildVariantOptionTuple(variant) === buildVariantOptionTuple(editedRow),
      );
      if (duplicateLive) {
        classification = "error";
        messages.push("Live Shopify variant already exists for this option tuple");
      }
      if (messages.length > 0) {
        classification = "error";
      }
    } else if (!variantId) {
      classification = "error";
      messages.push("variant_id is required for UPDATE and DELETE");
    } else if (!baselineRow) {
      classification = "error";
      messages.push("variant_id was not present in the selected export baseline");
    } else if (!currentRow) {
      classification = "error";
      messages.push("Live Shopify variant could not be found");
    } else if (command === "DELETE") {
      operation = "delete";
      validateReadOnlyColumns({ baselineRow, editedRow, messages });
      if (messages.length > 0) {
        classification = "error";
      } else if (!rowsEqual(currentRow, baselineRow)) {
        classification = "warning";
        messages.push("Live Shopify variant changed after the selected export baseline");
      }
    } else {
      operation = "update";
      validateReadOnlyColumns({ baselineRow, editedRow, messages });
      if (messages.length > 0) {
        classification = "error";
      } else if (!rowsEqual(currentRow, baselineRow)) {
        classification = "warning";
        messages.push("Live Shopify variant changed after the selected export baseline");
      } else if (changedFields.length === 0) {
        classification = "unchanged";
      }
    }

    return {
      baselineRow,
      changedFields: command === "CREATE" ? [
        "option1_value",
        "option2_value",
        "option3_value",
        "sku",
        "barcode",
        "taxable",
        "requires_shipping",
        "inventory_policy",
      ].filter((field) => String(editedRow[field] ?? "") !== "") : changedFields,
      classification,
      currentRow,
      editedRow,
      editedRowNumber: entry.rowNumber,
      messages,
      operation,
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
