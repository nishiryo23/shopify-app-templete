import crypto from "node:crypto";

function parseBase64Key(encodedKey, envVarName) {
  if (!encodedKey) {
    return null;
  }

  const key = Buffer.from(encodedKey, "base64");

  if (key.length !== 32) {
    throw new Error(`${envVarName} must decode to 32 bytes`);
  }

  return key;
}

let provenanceSigningKey;

function getCachedProvenanceSigningKey() {
  if (provenanceSigningKey !== undefined) {
    return provenanceSigningKey;
  }

  provenanceSigningKey = parseBase64Key(
    process.env.PROVENANCE_SIGNING_KEY,
    "PROVENANCE_SIGNING_KEY",
  );

  return provenanceSigningKey;
}

function resolveSigningKey(signingKey) {
  if (typeof signingKey === "string" || Buffer.isBuffer(signingKey)) {
    return signingKey;
  }

  return requireProvenanceSigningKey();
}

export function resetProvenanceSigningKeyCache() {
  provenanceSigningKey = undefined;
}

export function hasProvenanceSigningKey() {
  return getCachedProvenanceSigningKey() !== null;
}

export function requireProvenanceSigningKey() {
  const key = getCachedProvenanceSigningKey();

  if (!key) {
    throw new Error("PROVENANCE_SIGNING_KEY is required for provenance signing");
  }

  return key;
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function signHmacSha256Hex(value, signingKey) {
  return crypto.createHmac("sha256", resolveSigningKey(signingKey)).update(value).digest("hex");
}

export function buildRowFingerprint({ rowNumber, row, signingKey }) {
  return {
    rowNumber,
    digest: sha256Hex(row),
    signature: signHmacSha256Hex(`${rowNumber}:${row}`, signingKey),
  };
}

export function verifyRowFingerprint({ rowNumber, row, fingerprint, signingKey }) {
  if (!fingerprint || typeof fingerprint !== "object") {
    return { ok: false, reason: "invalid-row-fingerprint" };
  }

  if (fingerprint.rowNumber !== rowNumber) {
    return { ok: false, reason: "row-number-mismatch" };
  }

  if (fingerprint.digest !== sha256Hex(row)) {
    return { ok: false, reason: "row-digest-mismatch" };
  }

  if (fingerprint.signature !== signHmacSha256Hex(`${rowNumber}:${row}`, signingKey)) {
    return { ok: false, reason: "row-signature-mismatch" };
  }

  return { ok: true, reason: "verified" };
}
