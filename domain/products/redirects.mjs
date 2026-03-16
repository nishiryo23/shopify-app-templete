export function isHandleChangedFieldSet(changedFields) {
  return Array.isArray(changedFields) && changedFields.includes("handle");
}

const PRODUCT_HANDLE_PATTERN = /^[\p{Letter}\p{Number}-]+$/u;

export function normalizeProductHandle(handle) {
  return String(handle ?? "").trim().toLowerCase();
}

export function isValidProductHandle(handle) {
  const normalized = normalizeProductHandle(handle);
  return normalized.length > 0 && PRODUCT_HANDLE_PATTERN.test(normalized);
}

export function canonicalizeProductHandle(handle) {
  const normalized = normalizeProductHandle(handle);
  return isValidProductHandle(normalized) ? normalized : "";
}

export function buildProductRedirectPath(handle) {
  const normalized = normalizeProductHandle(handle);
  if (!normalized) {
    return "";
  }

  return `/products/${normalized}`;
}

export function buildHandleRedirectMetadata({ baselineRow, editedRow } = {}) {
  const previousHandle = normalizeProductHandle(baselineRow?.handle);
  const nextHandle = canonicalizeProductHandle(editedRow?.handle);

  return {
    nextHandle,
    previousHandle,
    redirectPath: previousHandle ? buildProductRedirectPath(previousHandle) : "",
    redirectTarget: nextHandle ? buildProductRedirectPath(nextHandle) : "",
  };
}

export function buildRedirectLookupKey({ path, target } = {}) {
  return `${String(path ?? "")}::${String(target ?? "")}`;
}

export function removeAlreadyAppliedHandleField(changedFields, { editedRow, liveRow } = {}) {
  if (!isHandleChangedFieldSet(changedFields)) {
    return Array.isArray(changedFields) ? [...changedFields] : [];
  }

  const normalizedEditedHandle = normalizeProductHandle(editedRow?.handle);
  const normalizedLiveHandle = normalizeProductHandle(liveRow?.handle);

  if (!normalizedEditedHandle || normalizedEditedHandle !== normalizedLiveHandle) {
    return Array.isArray(changedFields) ? [...changedFields] : [];
  }

  return changedFields.filter((field) => field !== "handle");
}
