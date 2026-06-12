import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("CI workflow enforces the standard verification gate on push and pull request", () => {
  const workflow = readProjectFile(".github/workflows/ci.yml");

  assert.match(workflow, /on:\s+push:\s+branches: \[main\]\s+pull_request:/m);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /corepack enable/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm run check/);
});

test("CI workflow stays runnable on a clean runner without external credentials", () => {
  const workflow = readProjectFile(".github/workflows/ci.yml");

  assert.doesNotMatch(workflow, /secrets\./, "CI gate must not require repository secrets");
  assert.doesNotMatch(workflow, /DATABASE_URL/, "CI gate must not require a database");
  assert.doesNotMatch(
    workflow,
    /playwright install/,
    "CI gate must not install browsers (smoke runs as --list only)",
  );
});
