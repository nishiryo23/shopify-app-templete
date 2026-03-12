import crypto from "node:crypto";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sign(value, signingKey) {
  return crypto.createHmac("sha256", signingKey).update(value).digest("hex");
}

function normalizeCsv(csvText) {
  return csvText.replace(/\r\n/g, "\n");
}

function splitCsvRecords(csvText) {
  const normalizedCsv = normalizeCsv(csvText);
  if (normalizedCsv.length === 0) {
    return [];
  }

  const records = [];
  let currentRecord = "";
  let inQuotes = false;

  for (let index = 0; index < normalizedCsv.length; index += 1) {
    const char = normalizedCsv[index];
    const nextChar = normalizedCsv[index + 1];

    if (char === "\"") {
      currentRecord += char;

      if (inQuotes && nextChar === "\"") {
        currentRecord += nextChar;
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "\n" && !inQuotes) {
      records.push(currentRecord);
      currentRecord = "";
      continue;
    }

    currentRecord += char;
  }

  if (currentRecord.length > 0 || !normalizedCsv.endsWith("\n")) {
    records.push(currentRecord);
  }

  return records;
}

function hasSequentialUniqueRowNumbers(rowFingerprints) {
  return rowFingerprints.every(
    (fingerprint, index) =>
      Number.isInteger(fingerprint.rowNumber) && fingerprint.rowNumber === index + 1,
  );
}

function isManifestRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildCsvManifest({ csvText, signingKey }) {
  const normalizedCsv = normalizeCsv(csvText);
  const rows = splitCsvRecords(normalizedCsv);
  const fileDigest = sha256(csvText);

  return {
    fileDigest,
    fileDigestSignature: sign(fileDigest, signingKey),
    rowFingerprints: rows.map((row, index) => ({
      rowNumber: index + 1,
      digest: sha256(row),
      signature: sign(`${index + 1}:${row}`, signingKey),
    })),
  };
}

export function verifyCsvManifest({ csvText, signingKey, manifest }) {
  const normalizedCsv = normalizeCsv(csvText);
  const actualFileDigest = sha256(csvText);

  if (!isManifestRecord(manifest)) {
    return { ok: false, reason: "invalid-manifest" };
  }

  if (typeof manifest.fileDigest !== "string") {
    return { ok: false, reason: "invalid-file-digest" };
  }

  if (typeof manifest.fileDigestSignature !== "string") {
    return { ok: false, reason: "invalid-file-digest-signature" };
  }

  if (actualFileDigest !== manifest.fileDigest) {
    return { ok: false, reason: "file-digest-mismatch" };
  }

  if (sign(manifest.fileDigest, signingKey) !== manifest.fileDigestSignature) {
    return { ok: false, reason: "file-digest-signature-mismatch" };
  }

  if (
    !Array.isArray(manifest.rowFingerprints) ||
    !manifest.rowFingerprints.every(isManifestRecord)
  ) {
    return { ok: false, reason: "invalid-row-fingerprints" };
  }

  const rows = splitCsvRecords(normalizedCsv);
  if (rows.length !== manifest.rowFingerprints.length) {
    return { ok: false, reason: "row-count-mismatch" };
  }

  if (!hasSequentialUniqueRowNumbers(manifest.rowFingerprints)) {
    return { ok: false, reason: "row-number-sequence-mismatch" };
  }

  for (const fingerprint of manifest.rowFingerprints) {
    const row = rows[fingerprint.rowNumber - 1];
    if (sha256(row) !== fingerprint.digest) {
      return { ok: false, reason: `row-digest-mismatch:${fingerprint.rowNumber}` };
    }

    if (sign(`${fingerprint.rowNumber}:${row}`, signingKey) !== fingerprint.signature) {
      return { ok: false, reason: `row-signature-mismatch:${fingerprint.rowNumber}` };
    }
  }

  return { ok: true, reason: "verified" };
}
