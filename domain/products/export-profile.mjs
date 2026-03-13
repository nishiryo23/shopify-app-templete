export const PRODUCT_EXPORT_KIND = "product.export";
export const PRODUCT_EXPORT_FORMAT = "csv";
export const PRODUCT_CORE_SEO_EXPORT_PROFILE = "product-core-seo-v1";
export const PRODUCT_EXPORT_SOURCE_ARTIFACT_KIND = "product.export.source";
export const PRODUCT_EXPORT_MANIFEST_ARTIFACT_KIND = "product.export.manifest";

export const PRODUCT_CORE_SEO_EXPORT_HEADERS = Object.freeze([
  "product_id",
  "handle",
  "title",
  "status",
  "vendor",
  "product_type",
  "tags",
  "body_html",
  "seo_title",
  "seo_description",
  "updated_at",
]);

export function buildProductExportDedupeKey({
  format = PRODUCT_EXPORT_FORMAT,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
} = {}) {
  return `product-export:${profile}:${format}`;
}

export function buildProductExportPayload({
  format = PRODUCT_EXPORT_FORMAT,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
} = {}) {
  return {
    format,
    profile,
  };
}

export function buildProductExportArtifactKey({
  fileName,
  jobId,
  prefix = "",
  shopDomain,
}) {
  const segments = [
    prefix.replace(/^\/+|\/+$/g, ""),
    "product-exports",
    shopDomain,
    jobId,
    fileName,
  ].filter(Boolean);

  return segments.join("/");
}
