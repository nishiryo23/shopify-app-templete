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
  assert.match(
    config,
    /\[\[webhooks\.subscriptions\]\]\s+compliance_topics = \[\s*"customers\/data_request",\s*"customers\/redact",\s*"shop\/redact"\s*\]\s+uri = "\/webhooks\/compliance"/m,
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
  const redactionMigration = readProjectFile(
    "prisma/migrations/20260317110000_make_webhook_inbox_payload_nullable_for_redaction/migration.sql",
  );

  assert.match(schema, /model WebhookInbox \{/);
  assert.match(schema, /deliveryKey\s+String\s+@unique/);
  assert.match(schema, /rawBody\s+String\?/);
  assert.match(schema, /hmacHeader\s+String\?/);
  assert.match(schema, /processedAt\s+DateTime\?/);
  assert.match(migration, /CREATE TABLE "WebhookInbox"/);
  assert.match(migration, /CREATE UNIQUE INDEX "WebhookInbox_deliveryKey_key"/);
  assert.match(migration, /"processedAt" TIMESTAMP\(3\)/);
  assert.match(redactionMigration, /ALTER TABLE "WebhookInbox"/);
  assert.match(redactionMigration, /ALTER COLUMN "rawBody" DROP NOT NULL/);
  assert.match(redactionMigration, /ALTER COLUMN "hmacHeader" DROP NOT NULL/);
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

test("platform foundation persists queue and artifact metadata in PostgreSQL", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const migration = readProjectFile(
    "prisma/migrations/20260313143000_add_job_and_artifact_foundation/migration.sql",
  );
  const retentionBackfillMigration = readProjectFile(
    "prisma/migrations/20260317123000_backfill_artifact_retention_until/migration.sql",
  );
  const systemSchedulerWindowMigration = readProjectFile(
    "prisma/migrations/20260318103000_add_system_job_scheduler_window_unique_index/migration.sql",
  );
  const queue = readProjectFile("domain/jobs/prisma-job-queue.mjs");
  const catalog = readProjectFile("domain/artifacts/prisma-artifact-catalog.mjs");
  const artifactStorage = readProjectFile("domain/artifacts/storage.mjs");
  const provenanceCrypto = readProjectFile("app/services/provenance-crypto.server.ts");

  assert.match(schema, /model Job \{/);
  assert.match(schema, /state\s+JobState\s+@default\(queued\)/);
  assert.match(schema, /model JobAttempt \{/);
  assert.match(schema, /@@unique\(\[jobId, attemptNumber\]\)/);
  assert.match(schema, /model Artifact \{/);
  assert.match(schema, /visibility\s+ArtifactVisibility\s+@default\(private\)/);
  assert.match(migration, /CREATE TABLE "Job"/);
  assert.match(migration, /CREATE TABLE "JobAttempt"/);
  assert.match(migration, /CREATE TABLE "Artifact"/);
  assert.match(retentionBackfillMigration, /UPDATE "Artifact"/);
  assert.match(retentionBackfillMigration, /product\.preview\.edited-upload/);
  assert.match(retentionBackfillMigration, /INTERVAL '7 days'/);
  assert.match(retentionBackfillMigration, /INTERVAL '90 days'/);
  assert.match(systemSchedulerWindowMigration, /CREATE UNIQUE INDEX "Job_system_scheduler_window_key"/);
  assert.match(systemSchedulerWindowMigration, /WHERE "shopDomain" = '__system__'/);
  assert.match(systemSchedulerWindowMigration, /AND "state" <> 'dead_letter'/);
  assert.match(migration, /CREATE UNIQUE INDEX "Job_shopDomain_kind_dedupeKey_active_key"/);
  assert.match(migration, /WHERE "dedupeKey" IS NOT NULL AND "state" IN \('queued', 'retryable', 'leased'\)/);
  assert.match(queue, /await ensureJobLeaseRow\(tx, candidate\.shopDomain\)/);
  assert.match(queue, /const lockedShop = await tx\.jobLease\.updateMany\(/);
  assert.match(queue, /leaseToken = crypto\.randomUUID\(\)/);
  assert.match(queue, /const updatedLease = await tx\.jobLease\.updateMany\(/);
  assert.match(queue, /leaseExpiresAt: \{ gt: now \}/);
  assert.match(queue, /const liveLease = await tx\.jobLease\.updateMany\(/);
  assert.match(queue, /const shouldDeadLetter = job\.attempts >= job\.maxAttempts/);
  assert.match(catalog, /bucket_objectKey/);
  assert.match(artifactStorage, /only supports private visibility/);
  assert.match(provenanceCrypto, /PROVENANCE_SIGNING_KEY/);
  assert.doesNotMatch(provenanceCrypto, /SHOP_TOKEN_ENCRYPTION_KEY/);
});

test("prisma schema persists queue and artifact foundation tables", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const migration = readProjectFile("prisma/migrations/20260313143000_add_job_and_artifact_foundation/migration.sql");

  assert.match(schema, /enum JobState \{/);
  assert.match(schema, /enum ArtifactVisibility \{/);
  assert.match(schema, /model Job \{/);
  assert.match(schema, /dedupeKey\s+String\?/);
  assert.doesNotMatch(schema, /@@unique\(\[shopDomain, kind, dedupeKey\]\)/);
  assert.match(schema, /@@index\(\[shopDomain, kind, dedupeKey\]\)/);
  assert.match(schema, /model JobAttempt \{/);
  assert.match(schema, /@@unique\(\[jobId, attemptNumber\]\)/);
  assert.match(schema, /model Artifact \{/);
  assert.match(schema, /visibility\s+ArtifactVisibility\s+@default\(private\)/);
  assert.match(migration, /CREATE TABLE "Job"/);
  assert.match(migration, /CREATE TABLE "JobAttempt"/);
  assert.match(migration, /CREATE TABLE "Artifact"/);
  assert.match(migration, /CREATE UNIQUE INDEX "Job_shopDomain_kind_dedupeKey_active_key"/);
  assert.match(migration, /CREATE UNIQUE INDEX "Artifact_bucket_objectKey_key"/);
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
    /if \(isScopesUpdateTopic\(normalizedTopic\)\) \{[\s\S]+await shopStateStore\.markScopesStale\(shop\);[\s\S]+await prisma\.webhookInbox\.update\(\{/m,
  );
  assert.match(
    handler,
    /function isScopesUpdateTopic\(topic: string\) \{\s+return topic === "app\/scopes_update" \|\| topic === "app\/scopes\/update";\s+\}/m,
  );
  assert.doesNotMatch(
    handler,
    /payload\.current|updateMany\(\{\s+where: \{ shop \},\s+data: \{ scope:/m,
  );
});

test("lifecycle webhooks go through durable ingress before side effects", () => {
  const handler = readProjectFile("domain/webhooks/enqueue.server.ts");
  const complianceRoute = readProjectFile("app/routes/webhooks.compliance.tsx");

  assert.doesNotMatch(handler, /^if \(process\.env\.NODE_ENV === "production"\)/m);
  assert.match(
    handler,
    /export async function enqueueWebhookInboxEvent\(\{ request \}: ActionFunctionArgs\) \{\s+requireWebhookTelemetryConfiguration\(process\.env\);/m,
  );
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
    /if \(!ingressResult\.enqueued && inboxEvent\.processedAt\) \{[\s\S]*return new Response\(null, \{ status: 200 \}\);/m,
  );
  assert.match(
    handler,
    /buildMetadataOnlyWebhookInboxData/,
  );
  assert.match(
    handler,
    /await prisma\.webhookInbox\.update\(\{\s+where: \{ deliveryKey \},\s+data: buildMetadataOnlyWebhookInboxData\(\{ processedAt: new Date\(\) \}\),\s+\}\);/m,
  );
  assert.match(handler, /event: "webhook\.received"/);
  assert.match(handler, /event: "webhook\.duplicate"/);
  assert.match(handler, /event: "webhook\.processed"/);
  assert.match(handler, /if \(normalizedTopic === "shop\/redact"\) \{\s+const job = await enqueueOrFindActiveWebhookShopRedactJob\(/m);
  assert.match(handler, /event: "webhook\.deferred"/);
  assert.match(handler, /if \(isComplianceTopic\(normalizedTopic\)\) \{/);
  assert.match(complianceRoute, /enqueueWebhookInboxEvent/);
});

test("authenticated admin loaders bootstrap shop state and custom session storage keeps offline tokens encrypted", () => {
  const server = readProjectFile("app/shopify.server.ts");
  const authBootstrap = readProjectFile("app/services/auth-bootstrap.server.ts");
  const billing = readProjectFile("app/services/billing.server.ts");
  const storage = readProjectFile("app/services/shop-session-storage.server.ts");
  const crypto = readProjectFile("app/services/session-crypto.server.ts");
  const bootstrap = readProjectFile("app/services/shop-state.server.ts");

  assert.match(server, /sessionStorage: new ShopSessionStorage\(prisma\)/);
  assert.doesNotMatch(server, /requireTelemetryPseudonymKey/);
  assert.doesNotMatch(server, /validateShopTokenEncryptionKey\(\);/);
  assert.match(authBootstrap, /const authContext = await authenticate\.admin\(request\);/);
  assert.match(authBootstrap, /const bootstrapState = await shopStateStore\.getBootstrapState\(shopDomain\);/);
  assert.match(authBootstrap, /if \(!bootstrapState\.lastBootstrapAt\) \{\s+return true;\s+\}/m);
  assert.match(authBootstrap, /if \(!\(await shouldBootstrapShopState\(authContext\.session\.shop\)\)\) \{\s+return;\s+\}/m);
  assert.match(authBootstrap, /try \{\s+await bootstrapShopState\(\{\s+scopes: authContext\.scopes,\s+shopDomain: authContext\.session\.shop,\s+store: shopStateStore,\s+\}\);\s+\} catch \(error\) \{/m);
  assert.match(authBootstrap, /console\.error\("Failed to bootstrap shop state after authentication"/);
  assert.match(storage, /if \(session\.isOnline\) \{\s+return this\.onlineStorage\.storeSession\(session\);/m);
  assert.match(storage, /if \(!this\.encryptedOfflineSessionsEnabled\) \{\s+return this\.onlineStorage\.storeSession\(session\);/m);
  assert.doesNotMatch(storage, /const encryptedOfflineSession = encryptOfflineSession\(session\);\s+await this\.onlineStorage\.storeSession\(session\);/m);
  assert.match(storage, /await this\.onlineStorage\.deleteSession\(session\.id\);/);
  assert.match(storage, /if \(prismaSession\?\.isOnline\) \{\s+return prismaSession;\s+\}/m);
  assert.match(storage, /return prismaSession \?\? undefined;/);
  assert.match(storage, /Discarding unreadable encrypted offline session/);
  assert.match(storage, /await this\.clearUnreadableOfflineSession\(\{ offlineSessionId: id \}\);/);
  assert.match(storage, /await this\.clearOfflineSessionReference\(\{ offlineSessionId: id \}\);/);
  assert.match(storage, /await this\.clearOfflineSessionReference\(\{ offlineSessionId: \{ in: ids \} \}\);/);
  assert.match(storage, /await this\.prisma\.shop\.upsert\(\{/);
  assert.match(crypto, /if \(!encodedKey\) \{\s+return null;\s+\}/m);
  assert.match(crypto, /SHOP_TOKEN_ENCRYPTION_KEY is required for encrypted offline session storage/);
  assert.match(bootstrap, /const scopeDetail = await scopes\.query\(\);/);
  assert.match(billing, /const authContext = await authenticateAndBootstrapShop\(request\);/);
  assert.match(billing, /return Response\.json\(entitlement\);/);
});

test("queue, artifact, and provenance crypto foundations stay separated by responsibility", () => {
  const queue = readProjectFile("domain/jobs/prisma-job-queue.mjs");
  const artifactStorage = readProjectFile("domain/artifacts/storage.mjs");
  const signing = readProjectFile("domain/provenance/signing.mjs");
  const sessionCrypto = readProjectFile("app/services/session-crypto.server.ts");
  const readme = readProjectFile("README.md");

  assert.match(queue, /await ensureJobLeaseRow\(tx, candidate\.shopDomain\)/);
  assert.match(queue, /leaseToken: job\.leaseToken/);
  assert.match(queue, /leaseExpiresAt: \{ gt: now \}/);
  assert.match(queue, /state: nextState/);
  assert.match(queue, /outcome: shouldDeadLetter \? "dead_letter" : "retryable"/);
  assert.match(artifactStorage, /Artifacts must remain private by default/);
  assert.match(artifactStorage, /Artifact objectKey must stay within the configured storage root/);
  assert.match(artifactStorage, /must not contain Windows path separators/);
  assert.match(artifactStorage, /path\.resolve\(resolvedRootDir, objectKey\)/);
  assert.match(artifactStorage, /const descriptors = new Map\(\)/);
  assert.match(artifactStorage, /contentType: storedDescriptor\?\.contentType/);
  assert.match(signing, /PROVENANCE_SIGNING_KEY is required for provenance signing/);
  assert.doesNotMatch(signing, /SHOP_TOKEN_ENCRYPTION_KEY is required for encrypted offline session storage/);
  assert.match(sessionCrypto, /SHOP_TOKEN_ENCRYPTION_KEY is required for encrypted offline session storage/);
  assert.match(readme, /PROVENANCE_SIGNING_KEY/);
  assert.match(readme, /未設定のまま署名が必要な処理を呼ぶと fail-fast/);
});
