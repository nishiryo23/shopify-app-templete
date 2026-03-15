import crypto from "node:crypto";

import { buildRowFingerprint, signHmacSha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_METAFIELDS_EXPORT_HEADERS } from "../products/export-profile.mjs";
import {
  canonicalizeMetafieldCsvValue,
  isSupportedProductMetafieldType,
  normalizeMetafieldMultilineValue,
} from "./preview-csv.mjs";

function csvCell(value) {
  const normalized = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function mapSupportedMetafieldToExportRow(product, metafield) {
  const type = String(metafield?.type ?? "");
  const normalizedValue = type === "multi_line_text_field"
    ? normalizeMetafieldMultilineValue(metafield?.value ?? "")
    : canonicalizeMetafieldCsvValue(type, metafield?.value ?? "");

  return {
    key: metafield?.key ?? "",
    namespace: metafield?.namespace ?? "",
    product_handle: product?.handle ?? "",
    product_id: product?.id ?? "",
    type,
    updated_at: metafield?.updatedAt ?? "",
    value: normalizedValue,
  };
}

export function mapProductNodeToMetafieldExportRows(product) {
  const metafields = Array.isArray(product?.metafields?.nodes) ? product.metafields.nodes : [];
  const rows = [];
  const skippedTypes = new Set();
  let skippedCount = 0;

  for (const metafield of metafields) {
    if (!isSupportedProductMetafieldType(metafield?.type)) {
      skippedCount += 1;
      if (metafield?.type) {
        skippedTypes.add(String(metafield.type));
      }
      continue;
    }

    rows.push(mapSupportedMetafieldToExportRow(product, metafield));
  }

  return {
    rows,
    skippedCount,
    skippedTypes,
  };
}

export function serializeProductMetafieldCsvRow(row) {
  return PRODUCT_METAFIELDS_EXPORT_HEADERS.map((header) => csvCell(row[header])).join(",");
}

export function createMetafieldExportCsvBuilder({ signingKey }) {
  const rowFingerprints = [];
  const fileDigest = crypto.createHash("sha256");
  const skippedTypes = new Set();
  let exportedRowCount = 0;
  let manifestRowCount = 0;
  let skippedCount = 0;
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
      return appendRecord(PRODUCT_METAFIELDS_EXPORT_HEADERS.join(","));
    }

    return "";
  }

  return {
    appendProducts(products) {
      let csvChunk = ensureHeader();

      for (const product of products) {
        const result = mapProductNodeToMetafieldExportRows(product);
        skippedCount += result.skippedCount;
        for (const type of result.skippedTypes) {
          skippedTypes.add(type);
        }
        for (const row of result.rows) {
          csvChunk += appendRecord(serializeProductMetafieldCsvRow(row));
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
        metadata: {
          skippedMetafieldTypes: [...skippedTypes].sort(),
          skippedMetafieldsCount: skippedCount,
        },
        rowCount: exportedRowCount,
      };
    },
  };
}
