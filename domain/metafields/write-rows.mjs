import {
  canonicalizeMetafieldStoredValue,
  metafieldRowsMatch,
  normalizeMetafieldForWrite,
} from "./preview-csv.mjs";

const METAFIELD_CHANGED_FIELDS = Object.freeze([
  "type",
  "value",
]);

export function getWritableMetafieldPreviewRows(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => row?.classification === "changed")
    : [];
}

export function buildMetafieldSetInputFromPreviewRow(row) {
  const editedRow = row?.editedRow ?? {};
  const errors = [];
  const type = String(editedRow.type ?? "").trim();

  if (!row?.productId) {
    errors.push("product_id は必須です");
  }

  if (!String(editedRow.namespace ?? "").trim()) {
    errors.push("namespace は必須です");
  }

  if (!String(editedRow.key ?? "").trim()) {
    errors.push("key は必須です");
  }

  if (!type) {
    errors.push("type は必須です");
  }

  if (!String(editedRow.value ?? "")) {
    errors.push("value は必須です");
  }

  if (errors.length > 0) {
    return { errors, ok: false };
  }

  return {
    input: {
      key: String(editedRow.key).trim(),
      namespace: String(editedRow.namespace).trim(),
      ownerId: row.productId,
      type,
      value: normalizeMetafieldForWrite(type, editedRow.value ?? ""),
    },
    ok: true,
  };
}

export function metafieldChangedFieldsMatch({ actualRow, changedFields, expectedRow }) {
  return (changedFields ?? []).every((field) => {
    if (field === "value") {
      return canonicalizeMetafieldStoredValue(expectedRow?.type ?? "", expectedRow?.value ?? "")
        === canonicalizeMetafieldStoredValue(actualRow?.type ?? "", actualRow?.value ?? "");
    }

    return (actualRow?.[field] ?? "") === (expectedRow?.[field] ?? "");
  });
}

export function buildMetafieldSummary(rows) {
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

export function metafieldWriteRowsMatch(leftRow, rightRow) {
  return metafieldRowsMatch(leftRow, rightRow);
}

export function getMetafieldChangedFields() {
  return METAFIELD_CHANGED_FIELDS;
}
