import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("P-002 plan records bootstrap, encrypted offline storage, and query-based scope truth", () => {
  const plan = readProjectFile("plans/P-002-shop-bootstrap-offline-token-scope-truth.md");

  assert.match(plan, /custom session storage/);
  assert.match(plan, /currentAppInstallation\.accessScopes/);
  assert.match(plan, /offline token は平文で永続化しない/);
  assert.match(plan, /uninstall cleanup を `Shop` row まで広げる/);
});
