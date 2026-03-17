export const PRODUCT_PREVIEW_KIND = "product.preview";
export const PRODUCT_PREVIEW_EDITED_UPLOAD_ARTIFACT_KIND = "product.preview.edited-upload";
export const PRODUCT_PREVIEW_RESULT_ARTIFACT_KIND = "product.preview.result";

export function buildProductPreviewArtifactKey({
  fileName,
  jobId,
  prefix = "",
  shopDomain,
}) {
  const segments = [
    prefix.replace(/^\/+|\/+$/g, ""),
    "product-previews",
    shopDomain,
    jobId,
    fileName,
  ].filter(Boolean);

  return segments.join("/");
}

export function buildProductPreviewDedupeKey({
  editedDigest,
  editedLayout = "canonical",
  editedRowMapDigest = "none",
  exportJobId,
}) {
  return `product-preview:${exportJobId}:${editedLayout}:${editedDigest}:${editedRowMapDigest}`;
}

export function buildProductPreviewPayload({
  editedDigest,
  editedFormat,
  editedLayout = "canonical",
  editedRowMapDigest = "none",
  editedUploadArtifactId,
  exportJobId,
  manifestArtifactId,
  profile,
  sourceFormat,
  sourceArtifactId,
}) {
  return {
    editedDigest,
    editedFormat,
    editedLayout,
    editedRowMapDigest,
    editedUploadArtifactId,
    exportJobId,
    manifestArtifactId,
    profile,
    sourceFormat,
    sourceArtifactId,
  };
}
