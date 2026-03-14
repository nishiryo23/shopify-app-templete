export const PRODUCT_WRITE_KIND = "product.write";
export const PRODUCT_UNDO_KIND = "product.undo";
export const PRODUCT_WRITE_SNAPSHOT_ARTIFACT_KIND = "product.write.snapshot";
export const PRODUCT_WRITE_RESULT_ARTIFACT_KIND = "product.write.result";
export const PRODUCT_WRITE_ERROR_ARTIFACT_KIND = "product.write.error";
export const PRODUCT_UNDO_RESULT_ARTIFACT_KIND = "product.undo.result";
export const PRODUCT_UNDO_ERROR_ARTIFACT_KIND = "product.undo.error";

export function buildProductWriteDedupeKey({ previewJobId }) {
  return `product-write:${previewJobId}`;
}

export function buildProductUndoDedupeKey({ writeJobId }) {
  return `product-undo:${writeJobId}`;
}

export function buildProductWritePayload({
  previewArtifactId,
  previewDigest,
  previewJobId,
  profile,
  confirmedBy,
}) {
  return {
    confirmedBy,
    previewArtifactId,
    previewDigest,
    previewJobId,
    profile,
  };
}

export function buildProductUndoPayload({
  profile,
  requestedBy,
  snapshotArtifactId,
  writeArtifactId,
  writeJobId,
}) {
  return {
    profile,
    requestedBy,
    snapshotArtifactId,
    writeArtifactId,
    writeJobId,
  };
}

export function buildProductWriteArtifactKey({
  fileName,
  jobId,
  prefix = "",
  shopDomain,
}) {
  const segments = [
    prefix.replace(/^\/+|\/+$/g, ""),
    "product-writes",
    shopDomain,
    jobId,
    fileName,
  ].filter(Boolean);

  return segments.join("/");
}

