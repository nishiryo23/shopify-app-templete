import { sha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_MEDIA_EXPORT_HEADERS } from "../products/export-profile.mjs";

const READ_ONLY_HEADERS = new Set([
  "product_handle",
  "media_content_type",
  "updated_at",
]);

const WRITABLE_HEADERS = new Set([
  "image_src",
  "image_alt",
  "image_position",
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
    actual.length !== PRODUCT_MEDIA_EXPORT_HEADERS.length
    || actual.some((value, index) => value !== PRODUCT_MEDIA_EXPORT_HEADERS[index])
  ) {
    throw new Error("CSV header must exactly match product-media-v1");
  }
}

function buildRowObject(cells) {
  const row = {};
  for (let index = 0; index < PRODUCT_MEDIA_EXPORT_HEADERS.length; index += 1) {
    row[PRODUCT_MEDIA_EXPORT_HEADERS[index]] = cells[index] ?? "";
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

function buildMediaRowKey(row) {
  return `${row?.product_id ?? ""}\u001e${row?.media_id ?? ""}`;
}

function diffChangedFields(baselineRow, editedRow) {
  const changedFields = [];
  for (const header of WRITABLE_HEADERS) {
    const baselineValue = baselineRow?.[header] ?? "";
    const editedValue = header === "image_position" && (editedRow?.[header] ?? "") === ""
      ? baselineValue
      : (editedRow?.[header] ?? "");

    if (baselineValue !== editedValue) {
      changedFields.push(header);
    }
  }
  return changedFields;
}

export function parseMediaPreviewCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    throw new Error("CSV must include a header row");
  }

  assertHeader(rows[0]);

  const parsedRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== PRODUCT_MEDIA_EXPORT_HEADERS.length) {
      throw new Error(`CSV row ${index + 1} must contain ${PRODUCT_MEDIA_EXPORT_HEADERS.length} columns`);
    }

    parsedRows.push({
      row: buildRowObject(cells),
      rowNumber: index + 1,
    });
  }

  return parsedRows;
}

export function indexMediaRows(parsedRows) {
  const productIds = new Set();
  const placeholderRowsByProductId = new Map();
  const rowsByKey = new Map();

  for (const entry of parsedRows) {
    if (entry.row.product_id) {
      productIds.add(entry.row.product_id);
    }

    const key = buildMediaRowKey(entry.row);
    if (entry.row.media_id && rowsByKey.has(key)) {
      throw new Error(`Duplicate media row detected: ${key}`);
    }

    if (entry.row.media_id) {
      rowsByKey.set(key, entry);
      continue;
    }

    if (entry.row.product_id) {
      if (!placeholderRowsByProductId.has(entry.row.product_id)) {
        placeholderRowsByProductId.set(entry.row.product_id, entry);
      }
    }
  }

  return {
    placeholderRowsByProductId,
    productIds,
    rowsByKey,
  };
}

export function mediaRowsMatch(leftRow, rightRow) {
  const normalizeImageSrc = (row) => String(row?.image_src ?? "").trim();

  return (leftRow?.image_alt ?? "") === (rightRow?.image_alt ?? "")
    && normalizeImageSrc(leftRow) === normalizeImageSrc(rightRow)
    && (leftRow?.image_position ?? "") === (rightRow?.image_position ?? "");
}

export function buildMediaPreviewDigest({
  baselineDigest,
  editedDigest,
  exportJobId,
  mediaSetByProduct,
  profile,
  rows,
  summary,
}) {
  return sha256Hex(JSON.stringify({
    baselineDigest,
    editedDigest,
    exportJobId,
    mediaSetByProduct: stableSortObject(mediaSetByProduct ?? {}),
    profile,
    rows: rows.map((row) => ({
      baselineRow: stableSortObject(row.baselineRow),
      changedFields: [...row.changedFields],
      classification: row.classification,
      currentRow: stableSortObject(row.currentRow),
      editedRow: stableSortObject(row.editedRow),
      editedRowNumber: row.editedRowNumber,
      mediaId: row.mediaId,
      productId: row.productId,
      sourceRowNumber: row.sourceRowNumber,
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
      messages.push(`${header} is read-only and must match the export baseline`);
    }
  }
}

function validateImageSrc(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return { valid: true };
  }

  if (!/^https:\/\/.+/i.test(trimmed)) {
    return {
      error: "image_src must be a valid HTTPS URL",
      valid: false,
    };
  }

  return { valid: true };
}

function validateImagePosition(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return { valid: true };
  }

  if (!/^\d+$/.test(trimmed) || Number.parseInt(trimmed, 10) < 1) {
    return {
      error: "image_position must be a positive integer",
      valid: false,
    };
  }

  return { valid: true };
}

function validateNewMediaContentType(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed === "IMAGE") {
    return { valid: true };
  }

  return {
    error: "media_content_type must be blank or IMAGE for new media",
    valid: false,
  };
}

export function buildMediaPreviewRows({
  baselinePlaceholderRowsByProductId,
  baselineProductIds,
  baselineRowsByKey,
  currentRowsByKey,
  editedRows,
}) {
  const rows = editedRows.map((entry) => {
    const editedRow = entry.row;
    const isNewMedia = !editedRow.media_id;
    const key = isNewMedia ? null : buildMediaRowKey(editedRow);
    const placeholderEntry = isNewMedia
      ? (baselinePlaceholderRowsByProductId?.get(editedRow.product_id || "") ?? null)
      : null;
    const baselineEntry = key
      ? (baselineRowsByKey.get(key) ?? null)
      : placeholderEntry;
    const baselineRow = baselineEntry?.row ?? null;
    const currentRow = key ? (currentRowsByKey.get(key) ?? null) : null;
    const sourceRowNumber = baselineEntry?.rowNumber ?? null;
    const messages = [];
    const productId = editedRow.product_id || null;
    const mediaId = editedRow.media_id || null;
    let changedFields = [];
    let classification = "changed";
    let operation = "update";

    if (!productId) {
      classification = "error";
      messages.push("product_id is required");
    } else if (!baselineProductIds?.has(productId)) {
      classification = "error";
      messages.push("product_id was not present in the selected export baseline");
    } else if (isNewMedia) {
      const contentTypeValidation = validateNewMediaContentType(editedRow.media_content_type);
      if (!contentTypeValidation.valid) {
        classification = "error";
        messages.push(contentTypeValidation.error);
      }

      const posValidation = validateImagePosition(editedRow.image_position);
      if (!posValidation.valid) {
        classification = "error";
        messages.push(posValidation.error);
      }

      if (!editedRow.image_src?.trim()) {
        if (baselineRow && mediaRowsMatch(baselineRow, editedRow)) {
          classification = "unchanged";
        } else {
          classification = "error";
          messages.push("image_src is required for new media");
        }
      } else if (messages.length === 0) {
        const srcValidation = validateImageSrc(editedRow.image_src);
        if (!srcValidation.valid) {
          classification = "error";
          messages.push(srcValidation.error);
        } else {
          operation = "create";
          changedFields = ["image_src", "image_alt", "image_position"].filter(
            (field) => (editedRow[field] ?? "") !== "",
          );
        }
      }
    } else if (!baselineRow) {
      classification = "error";
      messages.push("media_id was not present in the selected export baseline");
    } else if (!currentRow) {
      classification = "error";
      messages.push("Live Shopify media could not be found");
    } else {
      validateReadOnlyColumns({ baselineRow, editedRow, messages });

      const srcValidation = validateImageSrc(editedRow.image_src);
      if (!srcValidation.valid) {
        messages.push(srcValidation.error);
      }

      const posValidation = validateImagePosition(editedRow.image_position);
      if (!posValidation.valid) {
        messages.push(posValidation.error);
      }

      if (messages.length > 0) {
        classification = "error";
      } else if (!mediaRowsMatch(currentRow, baselineRow)) {
        classification = "warning";
        changedFields = [];
        messages.push("Live Shopify media changed after the selected export baseline");
      } else {
        changedFields = diffChangedFields(baselineRow, editedRow);

        if (!editedRow.image_src?.trim() && baselineRow.image_src?.trim()) {
          operation = "delete";
          changedFields = ["image_src"];
        } else if (
          editedRow.image_src?.trim()
          && baselineRow.image_src?.trim()
          && editedRow.image_src.trim() !== baselineRow.image_src.trim()
        ) {
          operation = "replace";
        }

        if (changedFields.length === 0) {
          classification = "unchanged";
        }
      }
    }

    return {
      baselineRow,
      changedFields,
      classification,
      currentRow,
      editedRow,
      editedRowNumber: entry.rowNumber,
      mediaId,
      messages,
      operation,
      productId,
      sourceRowNumber,
    };
  });

  return {
    rows,
    summary: buildSummary(rows),
  };
}
