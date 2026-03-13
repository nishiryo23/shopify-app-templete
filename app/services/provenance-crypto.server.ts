import {
  buildRowFingerprint,
  hasProvenanceSigningKey,
  requireProvenanceSigningKey,
  sha256Hex,
  signHmacSha256Hex,
} from "~/domain/provenance/signing.mjs";

export { hasProvenanceSigningKey };

// PROVENANCE_SIGNING_KEY is the only signing key this module reads.

export function signFileDigest(fileDigest: string) {
  return signHmacSha256Hex(fileDigest, requireProvenanceSigningKey());
}

export function signArbitraryValue(value: string) {
  return signHmacSha256Hex(value, requireProvenanceSigningKey());
}

export function buildSignedRowFingerprint({ row, rowNumber }: { row: string; rowNumber: number }) {
  return buildRowFingerprint({
    row,
    rowNumber,
    signingKey: requireProvenanceSigningKey(),
  });
}

export function digestArtifactBody(body: string | Buffer) {
  return sha256Hex(body);
}
