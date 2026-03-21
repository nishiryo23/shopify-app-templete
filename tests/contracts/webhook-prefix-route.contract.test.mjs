import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("/webhooks/app prefix route responds via a dedicated probe handler", () => {
  const route = readProjectFile("app/routes/webhooks.app.tsx");
  const service = readProjectFile("domain/webhooks/prefix-probe.server.ts");
  const webConfig = readProjectFile("shopify.web.toml");

  assert.match(webConfig, /webhooks_path = "\/webhooks\/app"/);
  assert.match(route, /handleWebhookPrefixProbe/);
  assert.match(service, /new Response\(null, \{ status: 204 \}\)/);
});
