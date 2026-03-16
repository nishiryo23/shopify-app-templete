import path from "node:path";
import { createReadStream } from "node:fs";

import { canonicalizeCsvSpreadsheet, parseCsvRows } from "../spreadsheets/csv.mjs";
import { buildXlsxBufferFromRows, buildXlsxFileFromCsvStream, canonicalizeXlsxWorksheet } from "../spreadsheets/xlsx.mjs";
import {
  PRODUCT_CORE_SEO_EXPORT_HEADERS,
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_EXPORT_FORMAT,
  PRODUCT_EXPORT_XLSX_FORMAT,
  PRODUCT_INVENTORY_EXPORT_HEADERS,
  PRODUCT_INVENTORY_EXPORT_PROFILE,
  PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS,
  PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE,
  PRODUCT_METAFIELDS_EXPORT_HEADERS,
  PRODUCT_METAFIELDS_EXPORT_PROFILE,
  PRODUCT_MEDIA_EXPORT_HEADERS,
  PRODUCT_MEDIA_EXPORT_PROFILE,
  PRODUCT_VARIANT_PRICES_EXPORT_HEADERS,
  PRODUCT_VARIANT_PRICES_EXPORT_PROFILE,
  PRODUCT_VARIANTS_EXPORT_HEADERS,
  PRODUCT_VARIANTS_EXPORT_PROFILE,
} from "./export-profile.mjs";

const PRODUCT_EXPORT_FORMAT_CONTENT_TYPES = Object.freeze({
  [PRODUCT_EXPORT_FORMAT]: "text/csv; charset=utf-8",
  [PRODUCT_EXPORT_XLSX_FORMAT]: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

const PRODUCT_EXPORT_FILE_NAMES = Object.freeze({
  edited: {
    [PRODUCT_EXPORT_FORMAT]: "edited.csv",
    [PRODUCT_EXPORT_XLSX_FORMAT]: "edited.xlsx",
  },
  source: {
    [PRODUCT_EXPORT_FORMAT]: "source.csv",
    [PRODUCT_EXPORT_XLSX_FORMAT]: "source.xlsx",
  },
});

function buildHeaderError(profile, format) {
  return format === PRODUCT_EXPORT_XLSX_FORMAT
    ? `XLSX header must exactly match ${profile}`
    : `CSV header must exactly match ${profile}`;
}

export function getProductExportHeaders(profile) {
  if (profile === PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE) {
    return PRODUCT_MANUAL_COLLECTIONS_EXPORT_HEADERS;
  }

  if (profile === PRODUCT_METAFIELDS_EXPORT_PROFILE) {
    return PRODUCT_METAFIELDS_EXPORT_HEADERS;
  }

  if (profile === PRODUCT_MEDIA_EXPORT_PROFILE) {
    return PRODUCT_MEDIA_EXPORT_HEADERS;
  }

  if (profile === PRODUCT_INVENTORY_EXPORT_PROFILE) {
    return PRODUCT_INVENTORY_EXPORT_HEADERS;
  }

  if (profile === PRODUCT_VARIANT_PRICES_EXPORT_PROFILE) {
    return PRODUCT_VARIANT_PRICES_EXPORT_HEADERS;
  }

  if (profile === PRODUCT_VARIANTS_EXPORT_PROFILE) {
    return PRODUCT_VARIANTS_EXPORT_HEADERS;
  }

  return PRODUCT_CORE_SEO_EXPORT_HEADERS;
}

export function getProductSpreadsheetContentType(format = PRODUCT_EXPORT_FORMAT) {
  return PRODUCT_EXPORT_FORMAT_CONTENT_TYPES[format] ?? PRODUCT_EXPORT_FORMAT_CONTENT_TYPES[PRODUCT_EXPORT_FORMAT];
}

export function getProductSpreadsheetFileName({ format = PRODUCT_EXPORT_FORMAT, kind }) {
  const names = PRODUCT_EXPORT_FILE_NAMES[kind];
  return names?.[format] ?? names?.[PRODUCT_EXPORT_FORMAT] ?? `${kind}.csv`;
}

export function assertProductSpreadsheetFileName({ fileName, format = PRODUCT_EXPORT_FORMAT, role }) {
  const extension = path.extname(String(fileName ?? "")).toLowerCase();
  const expectedExtension = format === PRODUCT_EXPORT_XLSX_FORMAT ? ".xlsx" : ".csv";

  if (extension !== expectedExtension) {
    throw new Error(`${role} file must use the ${expectedExtension} extension`);
  }
}

export async function canonicalizeProductSpreadsheet({
  body,
  format = PRODUCT_EXPORT_FORMAT,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
}) {
  const headers = getProductExportHeaders(profile);

  if (format === PRODUCT_EXPORT_XLSX_FORMAT) {
    return canonicalizeXlsxWorksheet({
      body,
      headerError: buildHeaderError(profile, format),
      headers,
      worksheetName: profile,
    });
  }

  return canonicalizeCsvSpreadsheet({
    csvText: Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? ""),
    headerError: buildHeaderError(profile, format),
    headers,
  });
}

export async function buildProductSourceBufferFromCanonicalCsv({
  canonicalCsvText,
  format = PRODUCT_EXPORT_FORMAT,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
}) {
  if (format === PRODUCT_EXPORT_XLSX_FORMAT) {
    const rows = parseCsvRows(canonicalCsvText);
    return buildXlsxBufferFromRows({
      rows,
      worksheetName: profile,
    });
  }

  return Buffer.from(canonicalCsvText, "utf8");
}

export async function buildProductSourceFileFromCanonicalCsvPath({
  csvPath,
  format = PRODUCT_EXPORT_FORMAT,
  outputPath,
  profile = PRODUCT_CORE_SEO_EXPORT_PROFILE,
}) {
  if (format === PRODUCT_EXPORT_XLSX_FORMAT) {
    await buildXlsxFileFromCsvStream({
      csvStream: createReadStream(csvPath, { encoding: "utf8" }),
      filePath: outputPath,
      worksheetName: profile,
    });
    return outputPath;
  }

  return csvPath;
}
