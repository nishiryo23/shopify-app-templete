import { sha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS } from "../products/export-profile.mjs";

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
    actual.length !== PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.length
    || actual.some((value, index) => value !== PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS[index])
  ) {
    throw new Error("CSV header must exactly match product-manual-collections-v1");
  }
}

function buildRowObject(cells) {
  const row = {};
  for (let index = 0; index < PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.length; index += 1) {
    row[PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS[index]] = cells[index] ?? "";
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

function normalizeMembership(value) {
  const membership = String(value ?? "").trim().toLowerCase();
  return membership === "member" || membership === "remove" ? membership : "";
}

function normalizeHandle(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildCollectionRowKey({ collectionId, productId }) {
  return `${productId ?? ""}\u001e${collectionId ?? ""}`;
}

function collectionRowsMatch(leftRow, rightRow) {
  return PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.every((header) => {
    if (header === "collection_handle") {
      return normalizeHandle(leftRow?.[header]) === normalizeHandle(rightRow?.[header]);
    }

    if (header === "membership") {
      return normalizeMembership(leftRow?.[header]) === normalizeMembership(rightRow?.[header]);
    }

    return (leftRow?.[header] ?? "") === (rightRow?.[header] ?? "");
  });
}

export function parseCollectionPreviewCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    throw new Error("CSV must include a header row");
  }

  assertHeader(rows[0]);

  const parsedRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (cells.length !== PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.length) {
      throw new Error(`CSV row ${index + 1} must contain ${PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.length} columns`);
    }

    parsedRows.push({
      row: buildRowObject(cells),
      rowNumber: index + 1,
    });
  }

  return parsedRows;
}

export function indexCollectionRows(parsedRows) {
  const collectionHandles = new Set();
  const collectionIds = new Set();
  const productIds = new Set();
  const rawIdentityKeys = new Set();

  for (const entry of parsedRows) {
    if (entry.row.product_id) {
      productIds.add(entry.row.product_id);
    }

    const collectionId = String(entry.row.collection_id ?? "").trim();
    const collectionHandle = normalizeHandle(entry.row.collection_handle);
    if (collectionId) {
      collectionIds.add(collectionId);
    }
    if (collectionHandle) {
      collectionHandles.add(collectionHandle);
    }

    const identityToken = collectionId || collectionHandle;
    if (entry.row.product_id && identityToken) {
      const rawKey = `${entry.row.product_id}\u001e${identityToken}`;
      if (rawIdentityKeys.has(rawKey)) {
        throw new Error(`Duplicate collection row detected: ${rawKey}`);
      }
      rawIdentityKeys.add(rawKey);
    }
  }

  return {
    collectionHandles,
    collectionIds,
    productIds,
  };
}

function resolveCollectionForRow({
  row,
  resolvedCollectionsByHandle,
  resolvedCollectionsById,
}) {
  const collectionId = String(row?.collection_id ?? "").trim();
  const normalizedHandle = normalizeHandle(row?.collection_handle);
  const resolvedById = collectionId ? resolvedCollectionsById.get(collectionId) ?? null : null;
  const resolvedByHandle = normalizedHandle ? resolvedCollectionsByHandle.get(normalizedHandle) ?? null : null;

  if (collectionId && normalizedHandle && resolvedById && resolvedByHandle && resolvedById.id !== resolvedByHandle.id) {
    return {
      error: "collection_id and collection_handle must refer to the same collection",
      resolvedCollection: null,
    };
  }

  return {
    error: null,
    resolvedCollection: resolvedById ?? resolvedByHandle ?? null,
  };
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

export function buildCollectionPreviewDigest({
  baselineDigest,
  editedDigest,
  exportJobId,
  profile,
  resolvedCollectionIdsByHandle,
  rows,
  summary,
}) {
  return sha256Hex(JSON.stringify({
    baselineDigest,
    editedDigest,
    exportJobId,
    profile,
    resolvedCollectionIdsByHandle: stableSortObject(resolvedCollectionIdsByHandle ?? {}),
    rows: rows.map((row) => ({
      baselineRow: stableSortObject(row.baselineRow),
      changedFields: [...row.changedFields],
      classification: row.classification,
      currentRow: stableSortObject(row.currentRow),
      editedRow: stableSortObject(row.editedRow),
      editedRowNumber: row.editedRowNumber,
      operation: row.operation,
      productId: row.productId,
      resolvedCollectionId: row.resolvedCollectionId,
      sourceRowNumber: row.sourceRowNumber,
    })),
    summary: stableSortObject(summary),
  }));
}

export function buildCollectionPreviewRows({
  baselineRows,
  currentRowsByKey,
  editedRows,
  existingProductIds,
  productRowsById,
  resolvedCollectionsByHandle,
  resolvedCollectionsById,
}) {
  const baselineRowsByKey = new Map();
  const editedRowKeys = new Set();

  for (const entry of baselineRows) {
    const { resolvedCollection } = resolveCollectionForRow({
      resolvedCollectionsByHandle,
      resolvedCollectionsById,
      row: entry.row,
    });
    if (!resolvedCollection?.id || !entry.row.product_id) {
      continue;
    }

    baselineRowsByKey.set(buildCollectionRowKey({
      collectionId: resolvedCollection.id,
      productId: entry.row.product_id,
    }), entry);
  }

  const rows = editedRows.map((entry) => {
    const messages = [];
    const productId = String(entry.row.product_id ?? "").trim();
    const productRow = productRowsById.get(productId) ?? null;
    const membership = normalizeMembership(entry.row.membership);

    if (!productId) {
      messages.push("product_id is required");
    } else if (!existingProductIds.has(productId)) {
      messages.push("product_id must reference an existing Shopify product");
    }

    if (!membership) {
      messages.push("membership must be member or remove");
    }

    const { error: collectionResolveError, resolvedCollection } = resolveCollectionForRow({
      resolvedCollectionsByHandle,
      resolvedCollectionsById,
      row: entry.row,
    });

    if (collectionResolveError) {
      messages.push(collectionResolveError);
    }

    if (!resolvedCollection) {
      messages.push("collection_id or collection_handle must reference an existing manual collection");
    } else if (resolvedCollection.ruleSet != null) {
      messages.push("smart collections are not supported in product-manual-collections-v1");
    }

    const key = resolvedCollection?.id && productId
      ? buildCollectionRowKey({
        collectionId: resolvedCollection.id,
        productId,
      })
      : null;
    const baselineEntry = key ? baselineRowsByKey.get(key) ?? null : null;
    const currentRow = key ? currentRowsByKey.get(key) ?? null : null;
    const baselineRow = baselineEntry?.row ?? null;

    if (key) {
      if (editedRowKeys.has(key)) {
        throw new Error(`Duplicate collection row detected: ${key}`);
      }
      editedRowKeys.add(key);
    }

    if (productRow) {
      if (baselineRow) {
        if ((entry.row.product_handle ?? "") !== baselineRow.product_handle) {
          messages.push("product_handle is read-only and must match the export baseline");
        }
      } else if (entry.row.product_handle && entry.row.product_handle !== productRow.product_handle) {
        messages.push("product_handle is read-only and must match Shopify");
      }
    }

    if (resolvedCollection) {
      if (baselineRow) {
        if ((entry.row.collection_id ?? "") !== baselineRow.collection_id) {
          messages.push("collection_id is read-only and must match the export baseline");
        }
        if ((entry.row.collection_handle ?? "") !== baselineRow.collection_handle) {
          messages.push("collection_handle is read-only and must match the export baseline");
        }
        if ((entry.row.collection_title ?? "") !== baselineRow.collection_title) {
          messages.push("collection_title is read-only and must match the export baseline");
        }
        if ((entry.row.updated_at ?? "") !== baselineRow.updated_at) {
          messages.push("updated_at is read-only and must match the export baseline");
        }
      } else {
        if (entry.row.collection_id && entry.row.collection_id !== resolvedCollection.id) {
          messages.push("collection_id is read-only and must match Shopify");
        }
        if (entry.row.collection_handle && normalizeHandle(entry.row.collection_handle) !== normalizeHandle(resolvedCollection.handle)) {
          messages.push("collection_handle is read-only and must match Shopify");
        }
        if (entry.row.collection_title && entry.row.collection_title !== resolvedCollection.title) {
          messages.push("collection_title is read-only and must match Shopify");
        }
        if (entry.row.updated_at) {
          messages.push("updated_at is read-only and must match Shopify");
        }
      }
    }

    if (messages.length > 0) {
      return {
        baselineRow,
        changedFields: [],
        classification: "error",
        currentRow,
        editedRow: entry.row,
        editedRowNumber: entry.rowNumber,
        messages,
        operation: membership === "remove" ? "remove" : "add",
        productId,
        resolvedCollectionId: resolvedCollection?.id ?? null,
        sourceRowNumber: baselineEntry?.rowNumber ?? null,
      };
    }

    const currentExists = Boolean(currentRow);
    const intendsMembership = membership === "member";
    const currentMatchesIntent = intendsMembership ? currentExists : !currentExists;
    const baselineMatchesCurrent = baselineRow == null
      ? currentRow == null
      : Boolean(currentRow) && collectionRowsMatch(currentRow, baselineRow);
    const changedFields = currentMatchesIntent ? [] : ["membership"];

    let classification = changedFields.length === 0 ? "unchanged" : "changed";
    if (!baselineMatchesCurrent) {
      classification = "warning";
      messages.push("Live Shopify collection changed after the selected export baseline");
    }

    return {
      baselineRow,
      changedFields,
      classification,
      currentRow,
      editedRow: {
        ...entry.row,
        collection_handle: resolvedCollection.handle ?? entry.row.collection_handle ?? "",
        collection_id: resolvedCollection.id ?? entry.row.collection_id ?? "",
        collection_title: resolvedCollection.title ?? entry.row.collection_title ?? "",
        membership,
        product_handle: productRow?.product_handle ?? entry.row.product_handle ?? "",
      },
      editedRowNumber: entry.rowNumber,
      messages,
      operation: intendsMembership ? "add" : "remove",
      productId,
      resolvedCollectionId: resolvedCollection.id,
      sourceRowNumber: baselineEntry?.rowNumber ?? null,
    };
  });

  return {
    rows,
    summary: buildSummary(rows),
  };
}
