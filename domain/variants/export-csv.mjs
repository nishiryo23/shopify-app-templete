import crypto from "node:crypto";

import { buildRowFingerprint, signHmacSha256Hex } from "../provenance/signing.mjs";
import { PRODUCT_VARIANTS_EXPORT_HEADERS } from "../products/export-profile.mjs";

function csvCell(value) {
  const normalized = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function normalizeOptionNames(product) {
  const options = Array.isArray(product?.options) ? product.options : [];
  const names = ["", "", ""];

  for (const option of options) {
    const position = Number(option?.position ?? 0);
    if (position >= 1 && position <= 3) {
      names[position - 1] = option?.name ?? "";
    }
  }

  return names;
}

function normalizeOptionValues(variant) {
  const selectedOptions = Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
  const values = ["", "", ""];

  for (let index = 0; index < selectedOptions.length && index < 3; index += 1) {
    values[index] = selectedOptions[index]?.value ?? "";
  }

  return values;
}

export function mapVariantNodeToExportRow(variant) {
  const product = variant?.product ?? {};
  const [option1Name, option2Name, option3Name] = normalizeOptionNames(product);
  const [option1Value, option2Value, option3Value] = normalizeOptionValues(variant);

  return {
    barcode: variant?.barcode ?? "",
    command: "",
    inventory_policy: variant?.inventoryPolicy ?? "",
    option1_name: option1Name,
    option1_value: option1Value,
    option2_name: option2Name,
    option2_value: option2Value,
    option3_name: option3Name,
    option3_value: option3Value,
    product_handle: product?.handle ?? "",
    product_id: product?.id ?? "",
    requires_shipping: variant?.inventoryItem?.requiresShipping == null
      ? ""
      : String(variant.inventoryItem.requiresShipping),
    sku: variant?.inventoryItem?.sku ?? "",
    taxable: variant?.taxable == null ? "" : String(variant.taxable),
    updated_at: variant?.updatedAt ?? "",
    variant_id: variant?.id ?? "",
  };
}

export function serializeVariantCsvRow(row) {
  return PRODUCT_VARIANTS_EXPORT_HEADERS.map((header) => csvCell(row[header])).join(",");
}

export function createVariantExportCsvBuilder({ signingKey }) {
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
      return appendRecord(PRODUCT_VARIANTS_EXPORT_HEADERS.join(","));
    }

    return "";
  }

  return {
    appendVariants(variants) {
      let csvChunk = ensureHeader();

      for (const variant of variants) {
        const row = mapVariantNodeToExportRow(variant);
        csvChunk += appendRecord(serializeVariantCsvRow(row));
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
