import crypto from "node:crypto";

import { buildRowFingerprint, signHmacSha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_MEDIA_EXPORT_HEADERS } from "../products/export-profile.mjs";

function csvCell(value) {
  const normalized = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

export function mapMediaNodeToExportRows(product) {
  const mediaNodes = Array.isArray(product?.media?.nodes)
    ? product.media.nodes
    : [];
  const imageRows = mediaNodes.flatMap((media, index) => (media?.mediaContentType === "IMAGE" ? [{
    image_alt: media?.alt ?? "",
    image_position: String(index + 1),
    image_src: media?.image?.url ?? media?.preview?.image?.url ?? "",
    media_content_type: media?.mediaContentType ?? "",
    media_id: media?.id ?? "",
    product_handle: product?.handle ?? "",
    product_id: product?.id ?? "",
    updated_at: media?.updatedAt ?? product?.updatedAt ?? "",
  }] : []));

  if (imageRows.length > 0) {
    return imageRows;
  }

  return [{
    image_alt: "",
    image_position: "",
    image_src: "",
    media_content_type: "IMAGE",
    media_id: "",
    product_handle: product?.handle ?? "",
    product_id: product?.id ?? "",
    updated_at: product?.updatedAt ?? "",
  }];
}

export function serializeMediaCsvRow(row) {
  return PRODUCT_MEDIA_EXPORT_HEADERS.map((header) => csvCell(row[header])).join(",");
}

export function createMediaExportCsvBuilder({ signingKey }) {
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
      return appendRecord(PRODUCT_MEDIA_EXPORT_HEADERS.join(","));
    }

    return "";
  }

  return {
    appendProducts(products) {
      let csvChunk = ensureHeader();

      for (const product of products) {
        for (const row of mapMediaNodeToExportRows(product)) {
          csvChunk += appendRecord(serializeMediaCsvRow(row));
          exportedRowCount += 1;
        }
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
