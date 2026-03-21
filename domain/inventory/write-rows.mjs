import { canonicalizeInventoryQuantity, inventoryRowsMatch } from "./preview-csv.mjs";

const INVENTORY_CHANGED_FIELDS = Object.freeze([
  "available",
]);

export function buildInventoryReferenceDocumentUri(previewJobId) {
  return `gid://matri/ProductPreview/${previewJobId}`;
}

export function getWritableInventoryPreviewRows(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => row?.classification === "changed")
    : [];
}

export function buildInventorySetQuantityInputFromPreviewRow(row) {
  const currentRow = row?.currentRow ?? row?.preWriteRow ?? null;
  const editedRow = row?.editedRow ?? {};
  const canonicalQuantity = canonicalizeInventoryQuantity(editedRow.available);
  const errors = [];

  if (!currentRow?.inventory_item_id) {
    errors.push("inventoryItemId は必須です");
  }

  if (!row?.locationId && !currentRow?.location_id) {
    errors.push("location_id は必須です");
  }

  if (!/^-?\d+$/.test(String(canonicalQuantity ?? "").trim())) {
    errors.push("available は符号付き整数である必要があります");
  }

  if (errors.length > 0) {
    return {
      errors,
      ok: false,
    };
  }

  return {
    input: {
      changeFromQuantity: Number.parseInt(String(canonicalizeInventoryQuantity(currentRow.available)), 10),
      inventoryItemId: currentRow.inventory_item_id,
      locationId: row?.locationId ?? currentRow.location_id,
      quantity: Number.parseInt(String(canonicalQuantity), 10),
    },
    ok: true,
  };
}

export function inventoryChangedFieldsMatch({ actualRow, changedFields, expectedRow }) {
  return (changedFields ?? []).every((field) => {
    if (field === "available") {
      return canonicalizeInventoryQuantity(actualRow?.available) === canonicalizeInventoryQuantity(expectedRow?.available);
    }

    return (actualRow?.[field] ?? "") === (expectedRow?.[field] ?? "");
  });
}

export function buildInventorySummary(rows) {
  const summary = {
    total: rows.length,
    verifiedSuccess: 0,
  };

  for (const row of rows) {
    if (row.verificationStatus === "verified") {
      summary.verifiedSuccess += 1;
    }
  }

  return summary;
}

export function inventoryWriteRowsMatch(leftRow, rightRow) {
  return inventoryRowsMatch(leftRow, rightRow);
}

export function getInventoryChangedFields() {
  return INVENTORY_CHANGED_FIELDS;
}
