import crypto from "node:crypto";
import { buildRowFingerprint, signHmacSha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_CORE_SEO_EXPORT_HEADERS } from "./export-profile.mjs";

function csvCell(value) {
  const normalized = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return "";
  }

  return tags.join(", ");
}

export function mapProductNodeToExportRow(product) {
  return {
    body_html: product.descriptionHtml ?? "",
    handle: product.handle ?? "",
    product_id: product.id ?? "",
    product_type: product.productType ?? "",
    seo_description: product.seo?.description ?? "",
    seo_title: product.seo?.title ?? "",
    status: product.status ?? "",
    tags: normalizeTags(product.tags),
    title: product.title ?? "",
    updated_at: product.updatedAt ?? "",
    vendor: product.vendor ?? "",
  };
}

export function serializeProductCoreSeoCsvRow(row) {
  return PRODUCT_CORE_SEO_EXPORT_HEADERS.map((header) => csvCell(row[header])).join(",");
}

export function createProductExportCsvBuilder({ signingKey }) {
  const rowFingerprints = [];
  const fileDigest = crypto.createHash("sha256");
  let exportedRowCount = 0;
  let manifestRowCount = 0;
  let wroteHeader = false;

  function appendRecord(record) {
    const csvChunk = `${record}\n`;
    manifestRowCount += 1;
    fileDigest.update(csvChunk);
    rowFingerprints.push(buildRowFingerprint({
      row: record,
      rowNumber: manifestRowCount,
      signingKey,
    }));
    return csvChunk;
  }

  function ensureHeader() {
    if (!wroteHeader) {
      wroteHeader = true;
      return appendRecord(PRODUCT_CORE_SEO_EXPORT_HEADERS.join(","));
    }

    return "";
  }

  return {
    appendProducts(products) {
      let csvChunk = ensureHeader();

      for (const product of products) {
        const row = mapProductNodeToExportRow(product);
        csvChunk += appendRecord(serializeProductCoreSeoCsvRow(row));
        exportedRowCount += 1;
      }

      return csvChunk;
    },

    finalize() {
      ensureHeader();
      const digest = fileDigest.digest("hex");

      return {
        manifest: {
          fileDigest: digest,
          fileDigestSignature: signHmacSha256Hex(digest, signingKey),
          rowFingerprints,
        },
        rowCount: exportedRowCount,
      };
    },
  };
}

export function buildProductExportArtifacts({
  products,
  signingKey,
}) {
  const builder = createProductExportCsvBuilder({ signingKey });
  const csvText = builder.appendProducts(products);
  const { manifest, rowCount } = builder.finalize();

  return {
    csvText,
    manifest,
    rowCount,
  };
}
