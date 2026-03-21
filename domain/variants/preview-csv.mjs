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
    actual.length !== PRODUCT_VARIANTS_EXPORT_HEADERS.length
    || actual.some((value, index) => value !== PRODUCT_VARIANTS_EXPORT_HEADERS[index])
  ) {
    throw new Error("CSV ヘッダーは product-variants-v1 と完全一致する必要があります");
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
    throw new Error("CSV にはヘッダー行が必要です");
  }

  assertHeader(rows[0]);

  const parsedRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== PRODUCT_VARIANTS_EXPORT_HEADERS.length) {
      throw new Error(`CSV の ${index + 1} 行目は ${PRODUCT_VARIANTS_EXPORT_HEADERS.length} 列である必要があります`);
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
      throw new Error(`バリエーション行が重複しています: ${key}`);
    }

    rowsByKey.set(key, entry);
    if (row.product_id) {
      productIds.add(row.product_id);
    }

    if ((command === "CREATE" || command === "UPDATE") && row.product_id) {
      const tupleKey = `${row.product_id}\u001d${buildVariantOptionTuple(row)}`;
      if (createTuples.has(tupleKey)) {
        throw new Error(`product_id + option の組み合わせが重複しています: ${row.product_id}`);
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
      messages.push(`${header} は読み取り専用で、export baseline と一致する必要があります`);
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
      messages.push(`option${index}_name は Shopify 上の最新の商品オプション名と一致する必要があります`);
      continue;
    }

    if (editedOptionName !== liveOptionName) {
      messages.push(`option${index}_name は Shopify 上の最新の商品オプション名と一致する必要があります`);
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
      messages.push("product_id は必須です");
    } else if (!baselineProductIds.has(productId)) {
      classification = "error";
      messages.push("product_id が選択したエクスポート baseline に存在しません");
    } else if (command === "INVALID") {
      classification = "error";
      messages.push("command は CREATE、UPDATE、DELETE、または空欄である必要があります");
    } else if (!currentProduct) {
      classification = "error";
      messages.push("Shopify 上の最新の商品が見つかりません");
    } else if (command === "CREATE") {
      operation = "create";
      if (variantId) {
        classification = "error";
        messages.push("CREATE のとき variant_id は空欄である必要があります");
      }
      if (editedRow.updated_at) {
        classification = "error";
        messages.push("CREATE のとき updated_at は空欄である必要があります");
      }
      if (!buildVariantOptionTuple(editedRow)) {
        classification = "error";
        messages.push("CREATE では少なくとも 1 つの option 値が必要です");
      }
      validateCreateOptionNames({ currentProduct, editedRow, messages });

      const duplicateLive = currentVariants.find(
        (variant) => buildVariantOptionTuple(variant) === buildVariantOptionTuple(editedRow),
      );
      if (duplicateLive) {
        classification = "error";
        messages.push("この option 組み合わせのバリエーションは、すでに Shopify 上に存在します");
      }
      if (messages.length > 0) {
        classification = "error";
      }
    } else if (!variantId) {
      classification = "error";
      messages.push("UPDATE と DELETE では variant_id が必須です");
    } else if (!baselineRow) {
      classification = "error";
      messages.push("variant_id が選択したエクスポート baseline に存在しません");
    } else if (!currentRow) {
      classification = "error";
      messages.push("Shopify 上の最新のバリエーションが見つかりません");
    } else if (command === "DELETE") {
      operation = "delete";
      validateReadOnlyColumns({ baselineRow, editedRow, messages });
      if (messages.length > 0) {
        classification = "error";
      } else if (!rowsEqual(currentRow, baselineRow)) {
        classification = "warning";
        messages.push("選択したエクスポート baseline 以降に、Shopify 上の最新のバリエーションが変更されました");
      }
    } else {
      operation = "update";
      validateReadOnlyColumns({ baselineRow, editedRow, messages });
      if (messages.length > 0) {
        classification = "error";
      } else if (!rowsEqual(currentRow, baselineRow)) {
        classification = "warning";
        messages.push("選択したエクスポート baseline 以降に、Shopify 上の最新のバリエーションが変更されました");
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
