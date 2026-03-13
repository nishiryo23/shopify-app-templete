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

test("prisma schema persists encrypted shop bootstrap state", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const migration = readProjectFile("prisma/migrations/20260313103000_add_shop_table/migration.sql");

  assert.match(schema, /model Shop \{/);
  assert.match(schema, /shopDomain\s+String\s+@id/);
  assert.match(schema, /offlineSessionId\s+String\?\s+@unique/);
  assert.match(schema, /encryptedOfflineSession\s+Json\?/);
  assert.match(schema, /grantedScopes\s+String\[\]/);
  assert.match(migration, /CREATE TABLE "Shop"/);
  assert.match(migration, /"encryptedOfflineSession" JSONB/);
});

test("app uninstall cleanup deletes sessions by shop even without an offline session object", () => {
  const handler = readProjectFile("domain/webhooks/enqueue.server.ts");

  assert.match(
    handler,
    /if \(normalizedTopic === "app\/uninstalled"\) \{\s+await prisma\.session\.deleteMany\(\{ where: \{ shop \} \}\);/m,
  );
  assert.match(
    handler,
    /if \(normalizedTopic === "app\/uninstalled"\) \{[\s\S]+await shopStateStore\.deleteShop\(shop\);/m,
  );
});

test("scope updates no longer trust webhook payload as scope truth", () => {
  const handler = readProjectFile("domain/webhooks/enqueue.server.ts");

  assert.match(
    handler,
    /if \(normalizedTopic === "app\/scopes\/update"\) \{[\s\S]+await shopStateStore\.markScopesStale\(shop\);[\s\S]+await prisma\.webhookInbox\.update\(\{/m,
  );
  assert.doesNotMatch(
    handler,
    /payload\.current|updateMany\(\{\s+where: \{ shop \},\s+data: \{ scope:/m,
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

test("authenticated admin loaders bootstrap shop state and custom session storage keeps offline tokens encrypted", () => {
  const server = readProjectFile("app/shopify.server.ts");
  const authBootstrap = readProjectFile("app/services/auth-bootstrap.server.ts");
  const billing = readProjectFile("app/services/billing.server.ts");
  const storage = readProjectFile("app/services/shop-session-storage.server.ts");
  const crypto = readProjectFile("app/services/session-crypto.server.ts");
  const bootstrap = readProjectFile("app/services/shop-state.server.ts");

  assert.match(server, /sessionStorage: new ShopSessionStorage\(prisma\)/);
  assert.doesNotMatch(server, /validateShopTokenEncryptionKey\(\);/);
  assert.match(authBootstrap, /const authContext = await authenticate\.admin\(request\);/);
  assert.match(authBootstrap, /const bootstrapState = await shopStateStore\.getBootstrapState\(shopDomain\);/);
  assert.match(authBootstrap, /if \(!bootstrapState\.lastBootstrapAt\) \{\s+return true;\s+\}/m);
  assert.match(authBootstrap, /if \(!\(await shouldBootstrapShopState\(authContext\.session\.shop\)\)\) \{\s+return;\s+\}/m);
  assert.match(authBootstrap, /try \{\s+await bootstrapShopState\(\{\s+scopes: authContext\.scopes,\s+shopDomain: authContext\.session\.shop,\s+store: shopStateStore,\s+\}\);\s+\} catch \(error\) \{/m);
  assert.match(authBootstrap, /console\.error\("Failed to bootstrap shop state after authentication"/);
  assert.match(storage, /if \(session\.isOnline\) \{\s+return this\.onlineStorage\.storeSession\(session\);/m);
  assert.match(storage, /if \(!this\.encryptedOfflineSessionsEnabled\) \{\s+return this\.onlineStorage\.storeSession\(session\);/m);
  assert.match(storage, /await this\.onlineStorage\.storeSession\(session\);/);
  assert.doesNotMatch(storage, /await this\.onlineStorage\.deleteSession\(session\.id\);/);
  assert.match(storage, /if \(prismaSession\?\.isOnline\) \{\s+return prismaSession;\s+\}/m);
  assert.match(storage, /return prismaSession \?\? undefined;/);
  assert.match(storage, /Discarding unreadable encrypted offline session/);
  assert.match(storage, /await this\.clearUnreadableOfflineSession\(\{ offlineSessionId: id \}\);/);
  assert.match(storage, /await this\.prisma\.shop\.upsert\(\{/);
  assert.match(crypto, /if \(!encodedKey\) \{\s+return null;\s+\}/m);
  assert.match(crypto, /SHOP_TOKEN_ENCRYPTION_KEY is required for encrypted offline session storage/);
  assert.match(bootstrap, /const scopeDetail = await scopes\.query\(\);/);
  assert.match(billing, /const authContext = await authenticateAndBootstrapShop\(request\);/);
  assert.match(billing, /return Response\.json\(entitlement\);/);
});
