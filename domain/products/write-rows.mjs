import { PRODUCT_CORE_SEO_EXPORT_HEADERS } from "./export-profile.mjs";
import {
  canonicalizeProductHandle,
  isHandleChangedFieldSet,
  isValidProductHandle,
  normalizeProductHandle,
} from "./redirects.mjs";

const EDITABLE_HEADERS = PRODUCT_CORE_SEO_EXPORT_HEADERS.filter((header) => header !== "updated_at");
const VALID_PRODUCT_STATUSES = new Set(["ACTIVE", "ARCHIVED", "DRAFT"]);

export function normalizeTagsForMutation(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeTagsForComparison(value) {
  return normalizeTagsForMutation(value).join(", ");
}

function normalizeComparableFieldValue(field, value) {
  if (field === "tags") {
    return normalizeTagsForComparison(value);
  }

  if (field === "status") {
    return String(value ?? "").trim().toUpperCase();
  }

  if (field === "handle") {
    return normalizeProductHandle(value);
  }

  return value ?? "";
}

export function getWritablePreviewRows(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => Array.isArray(row?.changedFields) && row.changedFields.length > 0)
    : [];
}

export function isValidProductStatus(value) {
  return VALID_PRODUCT_STATUSES.has(String(value ?? "").trim().toUpperCase());
}

export function buildProductUpdateInputFromPreviewRow(row, { allowRedirect = true } = {}) {
  const changedFields = Array.isArray(row?.changedFields) ? row.changedFields : [];
  const editedRow = row?.editedRow ?? {};
  const input = {
    id: editedRow.product_id,
  };
  const errors = [];

  for (const field of changedFields) {
    switch (field) {
      case "handle": {
        const handle = canonicalizeProductHandle(editedRow.handle);
        if (!isValidProductHandle(handle)) {
          errors.push(`invalid handle value: ${editedRow.handle}`);
        } else {
          input.handle = handle;
        }
        break;
      }
      case "title":
      case "vendor":
        input[field] = editedRow[field] ?? "";
        break;
      case "body_html":
        input.descriptionHtml = editedRow.body_html ?? "";
        break;
      case "product_type":
        input.productType = editedRow.product_type ?? "";
        break;
      case "tags":
        input.tags = normalizeTagsForMutation(editedRow.tags);
        break;
      case "status": {
        const status = String(editedRow.status ?? "").trim().toUpperCase();
        if (!isValidProductStatus(status)) {
          errors.push(`invalid status value: ${editedRow.status}`);
        } else {
          input.status = status;
        }
        break;
      }
      case "seo_title":
      case "seo_description":
        input.seo = {
          description: editedRow.seo_description ?? "",
          title: editedRow.seo_title ?? "",
        };
        break;
      default:
        if (EDITABLE_HEADERS.includes(field)) {
          errors.push(`unsupported changed field: ${field}`);
        }
        break;
    }
  }

  if (errors.length > 0) {
    return {
      errors,
      ok: false,
    };
  }

  if (allowRedirect && isHandleChangedFieldSet(changedFields)) {
    input.redirectNewHandle = true;
  }

  return {
    input,
    ok: true,
  };
}

export function buildRollbackInputFromSnapshotRow(snapshotRow) {
  const changedFields = Array.isArray(snapshotRow?.changedFields) ? snapshotRow.changedFields : [];
  const preWriteRow = snapshotRow?.preWriteRow ?? {};
  return buildProductUpdateInputFromPreviewRow({
    changedFields,
    editedRow: preWriteRow,
  }, { allowRedirect: false });
}

export function changedFieldsMatch({ changedFields, expectedRow, actualRow }) {
  return (changedFields ?? []).every(
    (field) => normalizeComparableFieldValue(field, expectedRow?.[field])
      === normalizeComparableFieldValue(field, actualRow?.[field]),
  );
}
