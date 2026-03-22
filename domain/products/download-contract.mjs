import {
  PRODUCT_EXPORT_FORMAT,
  PRODUCT_EXPORT_XLSX_FORMAT,
} from "./export-profile.mjs";

export const PRODUCT_EXPORT_DOWNLOAD_QUERY_KEYS = Object.freeze([
  "shop",
  "host",
  "embedded",
]);

const PRODUCT_EXPORT_DOWNLOAD_CONTENT_TYPES = Object.freeze({
  [PRODUCT_EXPORT_FORMAT]: "text/csv; charset=utf-8",
  [PRODUCT_EXPORT_XLSX_FORMAT]: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

const PRODUCT_EXPORT_DOWNLOAD_EXTENSIONS = Object.freeze({
  [PRODUCT_EXPORT_FORMAT]: "csv",
  [PRODUCT_EXPORT_XLSX_FORMAT]: "xlsx",
});

export function getProductDownloadContentType(format = PRODUCT_EXPORT_FORMAT) {
  return PRODUCT_EXPORT_DOWNLOAD_CONTENT_TYPES[format] ?? PRODUCT_EXPORT_DOWNLOAD_CONTENT_TYPES[PRODUCT_EXPORT_FORMAT];
}

export function getProductDownloadExtension(format = PRODUCT_EXPORT_FORMAT) {
  return PRODUCT_EXPORT_DOWNLOAD_EXTENSIONS[format] ?? PRODUCT_EXPORT_DOWNLOAD_EXTENSIONS[PRODUCT_EXPORT_FORMAT];
}

export function isProductDownloadContentType(contentType = "") {
  const normalized = String(contentType ?? "").trim().toLowerCase();
  return Object.values(PRODUCT_EXPORT_DOWNLOAD_CONTENT_TYPES).some(
    (candidate) => candidate.toLowerCase() === normalized,
  );
}

export function buildProductExportDownloadFallbackFileName({
  format = PRODUCT_EXPORT_FORMAT,
  jobId = "",
  profile = "",
} = {}) {
  const extension = getProductDownloadExtension(format);
  const shortJobId = String(jobId ?? "").slice(0, 8) || "download";
  const resolvedProfile = String(profile ?? "").trim() || "product-core-seo-v1";
  return `${resolvedProfile}-${shortJobId}.${extension}`;
}
