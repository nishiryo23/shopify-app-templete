import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCsvManifest,
  verifyCsvManifest,
} from "../../domain/provenance/csv-manifest.mjs";

const signingKey = "csv-signing-key";
const csvText = ["handle,title", "hat,Hat", "shirt,Shirt"].join("\n");

test("untampered CSV verifies with manifest and row fingerprints", () => {
  const manifest = buildCsvManifest({ csvText, signingKey });

  assert.deepEqual(verifyCsvManifest({ csvText, signingKey, manifest }), {
    ok: true,
    reason: "verified",
  });
});

test("zero-byte CSV is treated as zero records", () => {
  const manifest = buildCsvManifest({ csvText: "", signingKey });

  assert.deepEqual(manifest, {
    fileDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    fileDigestSignature: "96fa6385c1cb7db784a9067322a83253c6ef06394af60f75b4a50467e895b700",
    rowFingerprints: [],
  });
  assert.deepEqual(
    verifyCsvManifest({ csvText: "", signingKey, manifest }),
    {
      ok: true,
      reason: "verified",
    },
  );
});

test("tampered file is rejected by file digest", () => {
  const manifest = buildCsvManifest({ csvText, signingKey });
  const tamperedCsv = ["handle,title", "hat,Hat", "shirt,Shirt v2"].join("\n");

  assert.deepEqual(verifyCsvManifest({ csvText: tamperedCsv, signingKey, manifest }), {
    ok: false,
    reason: "file-digest-mismatch",
  });
});

test("newline-only changes are rejected by file digest", () => {
  const crlfCsvText = ["handle,title", "hat,Hat", "shirt,Shirt"].join("\r\n");
  const manifest = buildCsvManifest({ csvText: crlfCsvText, signingKey });
  const lfCsvText = ["handle,title", "hat,Hat", "shirt,Shirt"].join("\n");

  assert.deepEqual(verifyCsvManifest({ csvText: lfCsvText, signingKey, manifest }), {
    ok: false,
    reason: "file-digest-mismatch",
  });
});

test("recomputed file digest without signing key is rejected", () => {
  const crlfCsvText = ["handle,title", "hat,Hat", "shirt,Shirt"].join("\r\n");
  const manifest = buildCsvManifest({ csvText: crlfCsvText, signingKey });
  const lfCsvText = ["handle,title", "hat,Hat", "shirt,Shirt"].join("\n");
  const tamperedManifest = {
    ...manifest,
    fileDigest: buildCsvManifest({ csvText: lfCsvText, signingKey }).fileDigest,
  };

  assert.deepEqual(verifyCsvManifest({ csvText: lfCsvText, signingKey, manifest: tamperedManifest }), {
    ok: false,
    reason: "file-digest-signature-mismatch",
  });
});

test("tampered row signature is rejected", () => {
  const manifest = buildCsvManifest({ csvText, signingKey });
  const tamperedManifest = {
    ...manifest,
    rowFingerprints: manifest.rowFingerprints.map((row) =>
      row.rowNumber === 2 ? { ...row, signature: "tampered" } : row,
    ),
  };

  assert.deepEqual(verifyCsvManifest({ csvText, signingKey, manifest: tamperedManifest }), {
    ok: false,
    reason: "row-signature-mismatch:2",
  });
});

test("null manifest is rejected without throwing", () => {
  assert.deepEqual(verifyCsvManifest({ csvText, signingKey, manifest: null }), {
    ok: false,
    reason: "invalid-manifest",
  });
});

test("missing file digest signature is rejected", () => {
  const manifest = buildCsvManifest({ csvText, signingKey });
  const tamperedManifest = { ...manifest };
  delete tamperedManifest.fileDigestSignature;

  assert.deepEqual(verifyCsvManifest({ csvText, signingKey, manifest: tamperedManifest }), {
    ok: false,
    reason: "invalid-file-digest-signature",
  });
});

test("multiline quoted CSV field is treated as a single logical record", () => {
  const multilineCsvText = [
    "handle,body_html",
    "\"hat\",\"Line 1",
    "Line 2\"",
    "\"shirt\",\"Single line\"",
  ].join("\n");
  const manifest = buildCsvManifest({ csvText: multilineCsvText, signingKey });

  assert.equal(manifest.rowFingerprints.length, 3);
  assert.deepEqual(
    manifest.rowFingerprints.map((fingerprint) => fingerprint.rowNumber),
    [1, 2, 3],
  );
  assert.deepEqual(
    verifyCsvManifest({ csvText: multilineCsvText, signingKey, manifest }),
    {
      ok: true,
      reason: "verified",
    },
  );
});

test("malformed manifest with duplicate row numbers is rejected", () => {
  const manifest = buildCsvManifest({ csvText, signingKey });
  const malformedManifest = {
    ...manifest,
    rowFingerprints: [
      manifest.rowFingerprints[0],
      { ...manifest.rowFingerprints[0], rowNumber: 1 },
      manifest.rowFingerprints[2],
    ],
  };

  assert.deepEqual(
    verifyCsvManifest({ csvText, signingKey, manifest: malformedManifest }),
    {
      ok: false,
      reason: "row-number-sequence-mismatch",
    },
  );
});

test("malformed manifest with null fingerprint entry is rejected", () => {
  const manifest = buildCsvManifest({ csvText, signingKey });
  const malformedManifest = {
    ...manifest,
    rowFingerprints: [manifest.rowFingerprints[0], null, manifest.rowFingerprints[2]],
  };

  assert.deepEqual(
    verifyCsvManifest({ csvText, signingKey, manifest: malformedManifest }),
    {
      ok: false,
      reason: "invalid-row-fingerprints",
    },
  );
});

test("malformed manifest with missing row number is rejected", () => {
  const manifest = buildCsvManifest({ csvText, signingKey });
  const malformedManifest = {
    ...manifest,
    rowFingerprints: [
      manifest.rowFingerprints[0],
      { ...manifest.rowFingerprints[2], rowNumber: 3 },
    ],
  };

  assert.deepEqual(
    verifyCsvManifest({ csvText, signingKey, manifest: malformedManifest }),
    {
      ok: false,
      reason: "row-count-mismatch",
    },
  );
});
