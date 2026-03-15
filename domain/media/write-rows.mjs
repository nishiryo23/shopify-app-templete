import { mediaRowsMatch } from "./preview-csv.mjs";

const MEDIA_CHANGED_FIELDS = Object.freeze([
  "image_alt",
  "image_position",
]);

export function getWritableMediaPreviewRows(rows) {
  return Array.isArray(rows)
    ? rows.filter((row) => row?.classification === "changed")
    : [];
}

export function buildMediaCreateInputFromPreviewRow(row) {
  const editedRow = row?.editedRow ?? {};
  const errors = [];

  if (!row?.productId) {
    errors.push("product_id is required");
  }

  const src = (editedRow.image_src ?? "").trim();
  if (!src) {
    errors.push("image_src is required for new media");
  }

  const mediaContentType = (editedRow.media_content_type ?? "").trim();
  if (mediaContentType && mediaContentType !== "IMAGE") {
    errors.push("media_content_type must be blank or IMAGE for new media");
  }

  if (errors.length > 0) {
    return { errors, ok: false };
  }

  return {
    input: {
      alt: editedRow.image_alt ?? "",
      mediaContentType: "IMAGE",
      originalSource: src,
      productId: row.productId,
    },
    ok: true,
  };
}

export function buildMediaUpdateInputFromPreviewRow(row) {
  const editedRow = row?.editedRow ?? {};
  const errors = [];

  if (!row?.mediaId) {
    errors.push("media_id is required for update");
  }

  if (errors.length > 0) {
    return { errors, ok: false };
  }

  const input = {
    id: row.mediaId,
  };

  if (row.changedFields?.includes("image_alt") || row.operation === "replace") {
    input.alt = editedRow.image_alt ?? "";
  }

  if (Object.keys(input).length === 1) {
    return { input: null, ok: true };
  }

  return { input, ok: true };
}

export function buildMediaDeleteInputFromPreviewRow(row) {
  const errors = [];

  if (!row?.mediaId) {
    errors.push("media_id is required for delete");
  }

  if (!row?.productId) {
    errors.push("product_id is required for delete");
  }

  if (errors.length > 0) {
    return { errors, ok: false };
  }

  return {
    input: {
      mediaIds: [row.mediaId],
      productId: row.productId,
    },
    ok: true,
  };
}

function resolveMediaTargetPosition(row) {
  const editedPosition = (row?.editedRow?.image_position ?? "").trim();
  if (editedPosition) {
    return editedPosition;
  }

  if (row?.operation !== "replace") {
    return null;
  }

  const currentPosition = (row?.preWriteRow?.image_position ?? row?.currentRow?.image_position ?? "").trim();
  return currentPosition || null;
}

export function buildMediaReorderMovesForProduct(rows) {
  const positionRows = rows.filter(
    (row) => (row?.changedFields?.includes("image_position") || row?.operation === "replace")
      && row?.mediaId
      && resolveMediaTargetPosition(row),
  );

  if (positionRows.length === 0) {
    return null;
  }

  const moves = positionRows.map((row) => ({
    id: row.mediaId,
    newPosition: Number.parseInt(resolveMediaTargetPosition(row), 10) - 1,
  }));

  return moves;
}

export function mediaChangedFieldsMatch({ actualRow, changedFields, expectedRow }) {
  return (changedFields ?? []).every((field) => {
    if (field === "image_src") {
      return true;
    }

    if (field === "image_position") {
      if ((expectedRow?.[field] ?? "") === "") {
        return true;
      }

      return String(actualRow?.[field] ?? "") === String(expectedRow?.[field] ?? "");
    }

    return (actualRow?.[field] ?? "") === (expectedRow?.[field] ?? "");
  });
}

export function buildMediaSummary(rows) {
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

export function mediaWriteRowsMatch(leftRow, rightRow) {
  return mediaRowsMatch(leftRow, rightRow);
}

export function getMediaChangedFields() {
  return MEDIA_CHANGED_FIELDS;
}
