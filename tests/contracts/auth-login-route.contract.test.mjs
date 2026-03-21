import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("/auth/login uses shopify.login (not authenticate.admin)", () => {
  const loginRoute = readProjectFile("app/routes/auth.login.tsx");
  const authService = readProjectFile("app/services/auth.server.ts");

  assert.match(loginRoute, /runAuthLoginLoader/);
  assert.match(loginRoute, /runAuthLoginAction/);
  assert.doesNotMatch(loginRoute, /authenticate\.admin/);
  assert.match(authService, /return request\.method === "HEAD" \? null : login\(request\);/);
  assert.match(authService, /return login\(request\);/);
});
