import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("standard verification gate includes typecheck and production build", () => {
  const packageJson = JSON.parse(readProjectFile("package.json"));

  assert.match(packageJson.scripts.check, /pnpm run typecheck/);
  assert.match(packageJson.scripts.check, /pnpm run build/);
});

test("shopify app config whitelists the React Router auth callback", () => {
  const config = readProjectFile("shopify.app.toml");

  assert.match(config, /redirect_urls = \[\s*"https:\/\/example\.com\/auth\/callback"\s*\]/);
  assert.doesNotMatch(config, /https:\/\/example\.com\/api\/auth/);
});

test("shopify app config declares app-specific lifecycle webhooks", () => {
  const config = readProjectFile("shopify.app.toml");
  const webConfig = readProjectFile("shopify.web.toml");

  assert.match(
    config,
    /\[\[webhooks\.subscriptions\]\]\s+topics = \[\s*"app\/uninstalled"\s*\]\s+uri = "\/webhooks\/app\/uninstalled"/m,
  );
  assert.match(
    config,
    /\[\[webhooks\.subscriptions\]\]\s+topics = \[\s*"app\/scopes_update"\s*\]\s+uri = "\/webhooks\/app\/scopes_update"/m,
  );
  assert.match(webConfig, /webhooks_path = "\/webhooks\/app"/);
  assert.doesNotMatch(webConfig, /webhooks_path = "\/webhooks\/app\/uninstalled"/);
});

test("prisma session storage uses the shared PostgreSQL database", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const migrationLock = readProjectFile("prisma/migrations/migration_lock.toml");
  const migration = readProjectFile("prisma/migrations/20260312110000_init_session_table/migration.sql");
  const tsconfig = readProjectFile("tsconfig.json");

  assert.match(schema, /provider = "postgresql"/);
  assert.match(schema, /url\s+=\s+env\("DATABASE_URL"\)/);
  assert.equal(migrationLock.includes('provider = "postgresql"'), true);
  assert.equal(migration.includes("TIMESTAMP(3)"), true);
  assert.equal(migration.includes("DATETIME"), false);
  assert.equal(tsconfig.includes('"domain/**/*.ts"'), true);
});

test("prisma schema persists webhook inbox deliveries for durable ingress", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const migration = readProjectFile("prisma/migrations/20260313090000_add_webhook_inbox_table/migration.sql");

  assert.match(schema, /model WebhookInbox \{/);
  assert.match(schema, /deliveryKey\s+String\s+@unique/);
  assert.match(schema, /processedAt\s+DateTime\?/);
  assert.match(migration, /CREATE TABLE "WebhookInbox"/);
  assert.match(migration, /CREATE UNIQUE INDEX "WebhookInbox_deliveryKey_key"/);
  assert.match(migration, /"processedAt" TIMESTAMP\(3\)/);
});

test("app uninstall cleanup deletes sessions by shop even without an offline session object", () => {
  const handler = readProjectFile("domain/webhooks/enqueue.server.ts");

  assert.match(
    handler,
    /if \(normalizedTopic === "app\/uninstalled"\) \{\s+await prisma\.session\.deleteMany\(\{ where: \{ shop \} \}\);/m,
  );
  assert.doesNotMatch(
    handler,
    /if \(normalizedTopic === "app\/uninstalled"\) \{\s+if \(session\)/m,
  );
});

test("scope updates are synchronized across all sessions for the shop", () => {
  const handler = readProjectFile("domain/webhooks/enqueue.server.ts");

  assert.match(
    handler,
    /if \(normalizedTopic === "app\/scopes\/update"\) \{[\s\S]+const currentScopes = Array\.isArray\(payload\.current\)[\s\S]+await prisma\.session\.updateMany\(\{\s+where: \{ shop \},\s+data: \{ scope: currentScopes \},\s+\}\);/m,
  );
  assert.doesNotMatch(
    handler,
    /if \(session\) \{[\s\S]+updateMany/m,
  );
});

test("lifecycle webhooks go through durable ingress before side effects", () => {
  const handler = readProjectFile("domain/webhooks/enqueue.server.ts");

  assert.match(
    handler,
    /const ingressResult = await processWebhookIngress\(/,
  );
  assert.match(
    handler,
    /inbox: createPrismaWebhookInboxStore\(prisma\)/,
  );
  assert.match(
    handler,
    /if \(!ingressResult\.enqueued && inboxEvent\.processedAt\) \{\s+return new Response\(null, \{ status: 200 \}\);/m,
  );
  assert.match(
    handler,
    /await prisma\.webhookInbox\.update\(\{\s+where: \{ deliveryKey \},\s+data: \{ processedAt: new Date\(\) \},\s+\}\);/m,
  );
});
