export const PRODUCT_EXPORT_KIND = "product.export";
export const PRODUCT_EXPORT_FORMAT = "csv";
export const PRODUCT_CORE_SEO_EXPORT_PROFILE = "product-core-seo-v1";
export const PRODUCT_VARIANTS_EXPORT_PROFILE = "product-variants-v1";
export const PRODUCT_VARIANT_PRICES_EXPORT_PROFILE = "product-variants-prices-v1";
export const PRODUCT_INVENTORY_EXPORT_PROFILE = "product-inventory-v1";
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

export const PRODUCT_VARIANTS_EXPORT_HEADERS = Object.freeze([
  "command",
  "product_id",
  "product_handle",
  "variant_id",
  "option1_name",
  "option1_value",
  "option2_name",
  "option2_value",
  "option3_name",
  "option3_value",
  "sku",
  "barcode",
  "taxable",
  "requires_shipping",
  "inventory_policy",
  "updated_at",
]);

export const PRODUCT_VARIANT_PRICES_EXPORT_HEADERS = Object.freeze([
  "product_id",
  "product_handle",
  "variant_id",
  "option1_name",
  "option1_value",
  "option2_name",
  "option2_value",
  "option3_name",
  "option3_value",
  "price",
  "compare_at_price",
  "updated_at",
]);

export const PRODUCT_INVENTORY_EXPORT_HEADERS = Object.freeze([
  "product_id",
  "product_handle",
  "variant_id",
  "option1_name",
  "option1_value",
  "option2_name",
  "option2_value",
  "option3_name",
  "option3_value",
  "location_id",
  "location_name",
  "available",
  "updated_at",
]);

export const PRODUCT_EXPORT_PROFILES = Object.freeze([
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_VARIANTS_EXPORT_PROFILE,
  PRODUCT_VARIANT_PRICES_EXPORT_PROFILE,
  PRODUCT_INVENTORY_EXPORT_PROFILE,
]);

export function resolveProductExportProfile(value) {
  if (value === PRODUCT_INVENTORY_EXPORT_PROFILE) {
    return PRODUCT_INVENTORY_EXPORT_PROFILE;
  }

  if (value === PRODUCT_VARIANT_PRICES_EXPORT_PROFILE) {
    return PRODUCT_VARIANT_PRICES_EXPORT_PROFILE;
  }

  if (value === PRODUCT_VARIANTS_EXPORT_PROFILE) {
    return PRODUCT_VARIANTS_EXPORT_PROFILE;
  }

  return PRODUCT_CORE_SEO_EXPORT_PROFILE;
}

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
