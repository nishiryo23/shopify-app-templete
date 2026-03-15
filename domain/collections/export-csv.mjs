import crypto from "node:crypto";

import { buildRowFingerprint, signHmacSha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS } from "../products/export-profile.mjs";

function csvCell(value) {
  const normalized = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function isManualCollection(collection) {
  return collection?.ruleSet == null;
}

export function mapProductNodeToCollectionExportRows(product) {
  const collections = Array.isArray(product?.collections?.nodes) ? product.collections.nodes : [];
  return collections
    .filter((collection) => isManualCollection(collection))
    .map((collection) => ({
      collection_handle: collection?.handle ?? "",
      collection_id: collection?.id ?? "",
      collection_title: collection?.title ?? "",
      membership: "member",
      product_handle: product?.handle ?? "",
      product_id: product?.id ?? "",
      updated_at: collection?.updatedAt ?? product?.updatedAt ?? "",
    }));
}

export function serializeProductCollectionCsvRow(row) {
  return PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.map((header) => csvCell(row[header])).join(",");
}

export function createCollectionExportCsvBuilder({ signingKey }) {
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
      return appendRecord(PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS.join(","));
    }

    return "";
  }

  return {
    appendProducts(products) {
      let csvChunk = ensureHeader();

      for (const product of products) {
        const rows = mapProductNodeToCollectionExportRows(product);
        for (const row of rows) {
          csvChunk += appendRecord(serializeProductCollectionCsvRow(row));
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
