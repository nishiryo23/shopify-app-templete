import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("technical spec points review metadata at repo-local truth documents", () => {
  const spec = readProjectFile("docs/shopify_app_technical_spec_complete.md");

  assert.match(spec, /## 11\.4 review metadata/);
  assert.match(spec, /docs\/app-review-metadata\.md/);
  assert.match(spec, /docs\/reviewer-packet\.md/);
  assert.match(spec, /docs\/release-gate-matrix\.md/);
});

test("review metadata doc enumerates required submission fields and blocker sentinel", () => {
  const metadata = readProjectFile("docs/app-review-metadata.md");

  assert.match(metadata, /Support email/);
  assert.match(metadata, /Submission contact email/);
  assert.match(metadata, /Privacy policy URL/);
  assert.match(metadata, /docs\/reviewer-packet\.md/);
  assert.match(metadata, /docs\/release-gate-matrix\.md/);
  assert.match(metadata, /UNCONFIGURED_BEFORE_SUBMISSION/);
  assert.match(metadata, /Partner Dashboard/);
});

test("reviewer packet fixes the reviewer path and dry-run evidence shape", () => {
  const packet = readProjectFile("docs/reviewer-packet.md");

  assert.match(packet, /SMOKE_INSTALL_URL/);
  assert.match(packet, /SMOKE_REINSTALL_URL/);
  assert.match(packet, /SMOKE_EMBEDDED_APP_URL/);
  assert.match(packet, /SMOKE_PRICING_URL/);
  assert.match(packet, /SMOKE_INVALID_SESSION_XHR_URL/);
  assert.match(packet, /SMOKE_INVALID_SESSION_DOCUMENT_URL/);
  assert.match(packet, /SMOKE_STORAGE_STATE_PATH/);
  assert.match(packet, /install/i);
  assert.match(packet, /reinstall/i);
  assert.match(packet, /\/app/);
  assert.match(packet, /\/app\/pricing/);
  assert.match(packet, /x-shopify-retry-invalid-session-request: 1/);
  assert.match(packet, /pnpm run test:smoke/);
  assert.match(packet, /pnpm check/);
  assert.match(packet, /UNCONFIGURED_BEFORE_SUBMISSION/);
});

test("release gate matrix blocks submission until metadata and smoke evidence are aligned", () => {
  const gateMatrix = readProjectFile("docs/release-gate-matrix.md");
  const smokeChecklist = readProjectFile("docs/dev-store-smoke-checklist.md");

  assert.match(gateMatrix, /docs\/app-review-metadata\.md/);
  assert.match(gateMatrix, /docs\/reviewer-packet\.md/);
  assert.match(gateMatrix, /docs\/dev-store-smoke-checklist\.md/);
  assert.match(gateMatrix, /pnpm run test:smoke/);
  assert.match(gateMatrix, /pnpm check/);
  assert.match(gateMatrix, /UNCONFIGURED_BEFORE_SUBMISSION/);
  assert.match(smokeChecklist, /docs\/reviewer-packet\.md/);
});

test("ADR-0019 records review metadata and reviewer packet as release truth", () => {
  const adr = readProjectFile("adr/0019-app-review-metadata-and-reviewer-packet-truth.md");

  assert.match(adr, /docs\/app-review-metadata\.md/);
  assert.match(adr, /docs\/reviewer-packet\.md/);
  assert.match(adr, /docs\/release-gate-matrix\.md/);
  assert.match(adr, /UNCONFIGURED_BEFORE_SUBMISSION/);
  assert.match(adr, /shopify\.dev\/docs\/apps\/launch\/app-store-review\/submit-app-for-review/);
});
