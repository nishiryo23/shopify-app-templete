import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("app home root redirects to /app while preserving Shopify query params", () => {
  const route = readProjectFile("app/routes/_index.tsx");
  const service = readProjectFile("app/services/app-shell.server.ts");

  assert.match(route, /redirectAppHome/);
  assert.match(service, /const target = new URL\("\/app", url\);/);
  assert.match(service, /target\.search = url\.search;/);
  assert.match(service, /throw redirect\(`\$\{target\.pathname\}\$\{target\.search\}`\);/);
});
