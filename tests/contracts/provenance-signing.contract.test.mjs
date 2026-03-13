import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRowFingerprint,
  hasProvenanceSigningKey,
  resetProvenanceSigningKeyCache,
  requireProvenanceSigningKey,
  sha256Hex,
  signHmacSha256Hex,
  verifyRowFingerprint,
} from "../../domain/provenance/signing.mjs";

test("shared provenance helpers sign and verify row fingerprints", () => {
  const fingerprint = buildRowFingerprint({
    row: "hat,Hat",
    rowNumber: 2,
    signingKey: "test-key",
  });

  assert.equal(fingerprint.digest, sha256Hex("hat,Hat"));
  assert.equal(
    verifyRowFingerprint({
      fingerprint,
      row: "hat,Hat",
      rowNumber: 2,
      signingKey: "test-key",
    }).ok,
    true,
  );
  assert.equal(sha256Hex("hat,Hat"), fingerprint.digest);
  assert.equal(signHmacSha256Hex("2:hat,Hat", "test-key"), fingerprint.signature);
});

test("provenance signing key env helper is independent from shop token encryption", () => {
  delete process.env.PROVENANCE_SIGNING_KEY;
  resetProvenanceSigningKeyCache();
  assert.equal(hasProvenanceSigningKey(), false);
  assert.throws(() => requireProvenanceSigningKey(), /PROVENANCE_SIGNING_KEY is required/);

  process.env.PROVENANCE_SIGNING_KEY = Buffer.alloc(32, 7).toString("base64");
  resetProvenanceSigningKeyCache();
  assert.equal(hasProvenanceSigningKey(), true);
  assert.equal(requireProvenanceSigningKey().byteLength, 32);

  delete process.env.PROVENANCE_SIGNING_KEY;
  resetProvenanceSigningKeyCache();
});
