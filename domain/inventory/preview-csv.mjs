import { sha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_INVENTORY_EXPORT_HEADERS } from "../products/export-profile.mjs";

const READ_ONLY_HEADERS = new Set([
  "variant_id",
  "product_handle",
  "option1_name",
  "option1_value",
  "option2_name",
  "option2_value",
  "option3_name",
  "option3_value",
  "location_id",
  "location_name",
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
    throw new Error("CSV の解析に失敗しました: 閉じられていない引用符があります");
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
    actual.length !== PRODUCT_INVENTORY_EXPORT_HEADERS.length
    || actual.some((value, index) => value !== PRODUCT_INVENTORY_EXPORT_HEADERS[index])
  ) {
    throw new Error("CSV ヘッダーは product-inventory-v1 と完全一致する必要があります");
  }
}

function buildRowObject(cells) {
  const row = {};
  for (let index = 0; index < PRODUCT_INVENTORY_EXPORT_HEADERS.length; index += 1) {
    row[PRODUCT_INVENTORY_EXPORT_HEADERS[index]] = cells[index] ?? "";
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

function normalizeQuantityString(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }

  return String(Number.parseInt(trimmed, 10));
}

function quantityValuesEqual(left, right) {
  return normalizeQuantityString(left) === normalizeQuantityString(right);
}

function validateQuantityValue(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return {
      error: "available は必須です",
      valid: false,
    };
  }

  if (!/^-?\d+$/.test(trimmed)) {
    return {
      error: "available は符号付き整数である必要があります",
      valid: false,
    };
  }

  return {
    canonical: String(Number.parseInt(trimmed, 10)),
    valid: true,
  };
}

function buildInventoryRowKey(row) {
  return `${row?.variant_id ?? ""}\u001e${row?.location_id ?? ""}`;
}

function diffChangedFields(baselineRow, editedRow) {
  return quantityValuesEqual(baselineRow?.available, editedRow?.available) ? [] : ["available"];
}

export function parseInventoryPreviewCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    throw new Error("CSV にはヘッダー行が必要です");
  }

  assertHeader(rows[0]);

  const parsedRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== PRODUCT_INVENTORY_EXPORT_HEADERS.length) {
      throw new Error(`CSV の ${index + 1} 行目は ${PRODUCT_INVENTORY_EXPORT_HEADERS.length} 列である必要があります`);
    }

    parsedRows.push({
      row: buildRowObject(cells),
      rowNumber: index + 1,
    });
  }

  return parsedRows;
}

export function indexInventoryRows(parsedRows) {
  const productIds = new Set();
  const rowsByKey = new Map();

  for (const entry of parsedRows) {
    const hasVariantId = Boolean(entry?.row?.variant_id);
    const hasLocationId = Boolean(entry?.row?.location_id);

    if (hasVariantId && hasLocationId) {
      const key = buildInventoryRowKey(entry.row);
      if (rowsByKey.has(key)) {
        throw new Error(`在庫行が重複しています: ${key}`);
      }

      rowsByKey.set(key, entry);
    }
    if (entry.row.product_id) {
      productIds.add(entry.row.product_id);
    }
  }

  return {
    productIds,
    rowsByKey,
  };
}

export function inventoryRowsMatch(leftRow, rightRow) {
  return quantityValuesEqual(leftRow?.available, rightRow?.available);
}

export function buildInventoryPreviewDigest({
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
      editedRow: stableSortObject(row.editedRow),
      editedRowNumber: row.editedRowNumber,
      locationId: row.locationId,
      productId: row.productId,
      sourceRowNumber: row.sourceRowNumber,
      variantId: row.variantId,
    })),
    summary: stableSortObject(summary),
  }));
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
      messages.push(`${header} は読み取り専用で、export baseline と一致する必要があります`);
    }
  }
}

export function buildInventoryPreviewRows({
  baselineRowsByKey,
  currentRowsByKey,
  editedRows,
}) {
  const rows = editedRows.map((entry) => {
    const editedRow = entry.row;
    const key = buildInventoryRowKey(editedRow);
    const baselineEntry = baselineRowsByKey.get(key) ?? null;
    const baselineRow = baselineEntry?.row ?? null;
    const currentRow = currentRowsByKey.get(key) ?? null;
    const sourceRowNumber = baselineEntry?.rowNumber ?? null;
    const messages = [];
    let changedFields = baselineRow ? diffChangedFields(baselineRow, editedRow) : [];
    const productId = baselineRow?.product_id ?? editedRow.product_id ?? null;
    const variantId = editedRow.variant_id || null;
    const locationId = editedRow.location_id || null;
    let classification = "changed";

    if (!productId) {
      classification = "error";
      messages.push("product_id は必須です");
    } else if (!variantId) {
      classification = "error";
      messages.push("variant_id は必須です");
    } else if (!locationId) {
      classification = "error";
      messages.push("location_id は必須です");
    } else if (!baselineRow) {
      classification = "error";
      messages.push("variant_id + location_id が選択したエクスポート baseline に存在しません");
    } else if ((editedRow.product_id || "") !== productId) {
      classification = "error";
      messages.push("product_id は baseline 上でその在庫行を所有する商品と一致する必要があります");
    } else if (!currentRow) {
      classification = "error";
      messages.push("Shopify 上の最新の在庫レベルが見つかりません");
    } else if ((currentRow.product_id || "") !== productId) {
      classification = "error";
      messages.push("product_id は Shopify 上の最新でその在庫行を所有する商品と一致する必要があります");
    } else {
      validateReadOnlyColumns({ baselineRow, editedRow, messages });
      const quantityValidation = validateQuantityValue(editedRow.available);
      if (!quantityValidation.valid) {
        messages.push(quantityValidation.error);
      }

      if (messages.length > 0) {
        classification = "error";
      } else if (!inventoryRowsMatch(currentRow, baselineRow)) {
        classification = "warning";
        changedFields = [];
        messages.push("選択したエクスポート baseline 以降に、Shopify 上の最新の在庫レベルが変更されました");
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
      locationId,
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

export function canonicalizeInventoryQuantity(value) {
  return normalizeQuantityString(value) ?? value;
}
