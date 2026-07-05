import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildFunnelEventRetentionCutoff,
  buildFunnelEventShopWhere,
  containsPiiMetadataKey,
  FUNNEL_EVENT_RETENTION_DAYS,
  FUNNEL_EVENTS,
  FUNNEL_METADATA_ALLOWLIST,
  sanitizeFunnelMetadata,
} from "../../domain/growth/funnel-contract.mjs";
import {
  buildOnboardingChecklist,
  isMerchantCompletableOnboardingStepId,
  ONBOARDING_STEP_IDS,
  ONBOARDING_STEPS,
} from "../../domain/growth/onboarding.mjs";
import {
  resolveReviewPrompt,
  REVIEW_PROMPT_MIN_INSTALL_AGE_DAYS,
  REVIEW_PROMPT_REASK_INTERVAL_DAYS,
} from "../../domain/growth/review-request.mjs";
import {
  fingerprintTelemetryPseudonymKey,
  hashShopDomain,
} from "../../domain/telemetry/emf.mjs";
import {
  assertTelemetryPseudonymKeyFingerprint,
  TELEMETRY_PSEUDONYM_KEY_FINGERPRINT_ID,
} from "../../domain/growth/pseudonym-key.mjs";
import { eraseShopData } from "../../domain/webhooks/compliance.server.mjs";
import { validateRuntimeEnvironment } from "../../scripts/validate-runtime-env.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");
const pseudonymEnv = {
  TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 8).toString("base64"),
};

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

function createFingerprintStore({ existingFingerprint = null } = {}) {
  const creates = [];
  let storedFingerprint = existingFingerprint;

  return {
    creates,
    async create({ data }) {
      if (storedFingerprint) {
        const error = new Error("duplicate");
        error.code = "P2002";
        throw error;
      }

      creates.push(data);
      storedFingerprint = data.fingerprintSha256;
      return data;
    },
    async findUnique() {
      return storedFingerprint
        ? { fingerprintSha256: storedFingerprint }
        : null;
    },
  };
}

function createEraseShopDataPrisma({ fingerprintStore, funnelDeleteCount = 0 }) {
  const deleted = [];
  let artifactFindManyCalled = false;
  let transactionRan = false;
  let existingFunnelEvent = null;

  return {
    deleted,
    setExistingFunnelEvent(value) {
      existingFunnelEvent = value;
    },
    get artifactFindManyCalled() {
      return artifactFindManyCalled;
    },
    get transactionRan() {
      return transactionRan;
    },
    prisma: {
      telemetryPseudonymKeyFingerprint: fingerprintStore,
      funnelEvent: {
        async findFirst() {
          return existingFunnelEvent;
        },
      },
      artifact: {
        async findMany() {
          artifactFindManyCalled = true;
          return [];
        },
      },
      async $transaction(callback) {
        transactionRan = true;
        return callback({
          artifact: {
            async deleteMany(args) {
              deleted.push(["artifact", args]);
              return { count: 0 };
            },
          },
          job: {
            async deleteMany(args) {
              deleted.push(["job", args]);
              return { count: 0 };
            },
          },
          jobLease: {
            async deleteMany(args) {
              deleted.push(["jobLease", args]);
              return { count: 0 };
            },
          },
          session: {
            async deleteMany(args) {
              deleted.push(["session", args]);
              return { count: 0 };
            },
          },
          shop: {
            async deleteMany(args) {
              deleted.push(["shop", args]);
              return { count: 0 };
            },
          },
          onboardingProgress: {
            async deleteMany(args) {
              deleted.push(["onboardingProgress", args]);
              return { count: 0 };
            },
          },
          reviewRequestState: {
            async deleteMany(args) {
              deleted.push(["reviewRequestState", args]);
              return { count: 0 };
            },
          },
          growthState: {
            async deleteMany(args) {
              deleted.push(["growthState", args]);
              return { count: 0 };
            },
          },
          funnelEvent: {
            async deleteMany(args) {
              deleted.push(["funnelEvent", args]);
              return { count: funnelDeleteCount };
            },
          },
          webhookInbox: {
            async deleteMany(args) {
              deleted.push(["webhookInbox", args]);
              return { count: 0 };
            },
          },
        });
      },
    },
  };
}

test("growth funnel vocabulary and metadata allowlist are fixed", () => {
  assert.deepEqual(FUNNEL_EVENTS, [
    "installed",
    "onboarding_step_completed",
    "activated",
    "plan_selection_viewed",
    "subscription_active",
    "uninstalled",
  ]);
  assert.deepEqual(FUNNEL_METADATA_ALLOWLIST.installed, ["source"]);
  assert.deepEqual(FUNNEL_METADATA_ALLOWLIST.uninstalled, [
    "installedAt",
    "tenureDays",
    "lastEntitlementState",
    "onboardingCompletedSteps",
    "onboardingTotalSteps",
    "onboardingCompletionRate",
  ]);
});

test("growth funnel metadata rejects free-form keys and customer PII", () => {
  assert.deepEqual(
    sanitizeFunnelMetadata({
      event: "plan_selection_viewed",
      metadata: {
        entitlementState: "NOT_ENTITLED",
        hasPlanSelectionUrl: true,
      },
    }),
    {
      entitlementState: "NOT_ENTITLED",
      hasPlanSelectionUrl: true,
    },
  );
  assert.throws(
    () => sanitizeFunnelMetadata({
      event: "plan_selection_viewed",
      metadata: { arbitrary: "value" },
    }),
    /not allowed/,
  );
  assert.throws(
    () => sanitizeFunnelMetadata({
      event: "installed",
      metadata: { customerEmail: "buyer@example.com" },
    }),
    /prohibited/,
  );
  assert.equal(containsPiiMetadataKey("phone"), true);
  assert.equal(containsPiiMetadataKey("subscriptionNamePresent"), false);
});

test("growth funnel uses TELEMETRY_PSEUDONYM_KEY and never falls back to raw shop ids", () => {
  assert.deepEqual(
    buildFunnelEventShopWhere({
      env: pseudonymEnv,
      shopDomain: "example.myshopify.com",
    }),
    {
      shopHash: hashShopDomain("example.myshopify.com", pseudonymEnv),
    },
  );
  assert.equal(
    buildFunnelEventShopWhere({
      env: { NODE_ENV: "development" },
      shopDomain: "example.myshopify.com",
    }),
    null,
  );
});

test("telemetry pseudonym key fingerprint is persisted and blocks implicit rotation", async () => {
  const fingerprintStore = createFingerprintStore();
  const prisma = {
    funnelEvent: {
      async findFirst() {
        return null;
      },
    },
    telemetryPseudonymKeyFingerprint: fingerprintStore,
  };

  const fingerprint = await assertTelemetryPseudonymKeyFingerprint({
    env: pseudonymEnv,
    prismaClient: prisma,
  });

  assert.equal(fingerprint, fingerprintTelemetryPseudonymKey(pseudonymEnv));
  assert.deepEqual(fingerprintStore.creates, [{
    fingerprintSha256: fingerprint,
    id: TELEMETRY_PSEUDONYM_KEY_FINGERPRINT_ID,
  }]);

  await assert.rejects(
    assertTelemetryPseudonymKeyFingerprint({
      env: {
        TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 9).toString("base64"),
      },
      prismaClient: prisma,
    }),
    /implicit key rotation is blocked/,
  );
});

test("telemetry pseudonym key fingerprint missing with existing FunnelEvent fails fast", async () => {
  await assert.rejects(
    assertTelemetryPseudonymKeyFingerprint({
      env: {
        TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 10).toString("base64"),
      },
      prismaClient: {
        funnelEvent: {
          async findFirst() {
            return { id: "funnel-existing" };
          },
        },
        telemetryPseudonymKeyFingerprint: createFingerprintStore(),
      },
    }),
    /fingerprint row is missing while FunnelEvent rows exist/,
  );
});

test("runtime validation owns production telemetry key fail-fast outside webhook ingress", () => {
  const packageJson = JSON.parse(readProjectFile("package.json"));

  assert.throws(
    () => validateRuntimeEnvironment({ NODE_ENV: "production" }),
    /TELEMETRY_PSEUDONYM_KEY is required/,
  );
  assert.doesNotThrow(() => validateRuntimeEnvironment({ NODE_ENV: "development" }));
  assert.match(packageJson.scripts.start, /validate-runtime-env\.mjs/);
});

test("growth funnel retention is registered as a 90 day hard-delete cutoff", () => {
  const now = new Date("2026-07-05T00:00:00.000Z");

  assert.equal(FUNNEL_EVENT_RETENTION_DAYS, 90);
  assert.equal(
    buildFunnelEventRetentionCutoff(now).toISOString(),
    "2026-04-06T00:00:00.000Z",
  );
});

test("onboarding registry exposes stable step ids and completion rules", () => {
  assert.deepEqual(ONBOARDING_STEP_IDS, [
    "plan_selection_viewed",
    "subscription_active",
    "activated",
  ]);
  assert.equal(ONBOARDING_STEPS.length, 3);
  assert.equal(isMerchantCompletableOnboardingStepId("activated"), true);
  assert.equal(isMerchantCompletableOnboardingStepId("plan_selection_viewed"), false);
  assert.equal(isMerchantCompletableOnboardingStepId("subscription_active"), false);

  const activeChecklist = buildOnboardingChecklist({
    entitlementState: "ACTIVE_PAID",
    progressRows: [
      { completedAt: new Date("2026-07-01T00:00:00.000Z"), stepId: "plan_selection_viewed" },
      { completedAt: new Date("2026-07-02T00:00:00.000Z"), stepId: "activated" },
    ],
  });

  assert.equal(activeChecklist.completedStepCount, 3);
  assert.equal(activeChecklist.isComplete, true);
  assert.equal(activeChecklist.steps.find((step) => step.id === "subscription_active")?.completed, true);
});

test("review prompt state machine covers every policy branch", () => {
  const installedAt = new Date("2026-07-01T00:00:00.000Z");
  const activatedAt = new Date("2026-07-02T00:00:00.000Z");
  const eligibleNow = new Date("2026-07-09T00:00:00.000Z");
  const base = {
    activatedAt,
    entitlementState: "ACTIVE_PAID",
    installedAt,
    now: eligibleNow,
    onboardingComplete: true,
    reviewUrl: "https://apps.shopify.com/example/reviews/new",
  };

  assert.equal(resolveReviewPrompt({ ...base, reviewUrl: "" }).reason, "missing_review_url");
  assert.equal(resolveReviewPrompt({ ...base, entitlementState: "NOT_ENTITLED" }).reason, "not_paid");
  assert.equal(resolveReviewPrompt({ ...base, onboardingComplete: false }).reason, "onboarding_incomplete");
  assert.equal(resolveReviewPrompt({ ...base, activatedAt: null }).reason, "not_activated");
  assert.equal(resolveReviewPrompt({ ...base, installedAt: null }).reason, "missing_install_date");
  assert.equal(resolveReviewPrompt({ ...base, now: new Date("2026-07-05T00:00:00.000Z") }).reason, "too_early");
  assert.equal(resolveReviewPrompt({ ...base, dismissedPermanently: true }).reason, "dismissed");
  assert.equal(resolveReviewPrompt({ ...base, askedAt: new Date("2026-07-01T00:00:00.000Z") }).reason, "cooldown");

  const eligible = resolveReviewPrompt({
    ...base,
    askedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(eligible.reason, "eligible");
  assert.equal(eligible.shouldShow, true);
  assert.equal(REVIEW_PROMPT_MIN_INSTALL_AGE_DAYS, 7);
  assert.equal(REVIEW_PROMPT_REASK_INTERVAL_DAYS, 180);
});

test("growth schema keeps FunnelEvent pseudonymous and shop-redact deletes all growth tables", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const funnelModel = schema.match(/model FunnelEvent \{[\s\S]+?\n\}/)?.[0] ?? "";
  const migration = readProjectFile("prisma/migrations/20260705120000_add_growth_kit_tables/migration.sql");
  const compliance = readProjectFile("domain/webhooks/compliance.server.mjs");

  assert.match(funnelModel, /shopHash\s+String/);
  assert.match(funnelModel, /dedupeKey\s+String\?/);
  assert.doesNotMatch(funnelModel, /shopDomain/);
  assert.match(funnelModel, /@@index\(\[occurredAt\]\)/);
  assert.match(funnelModel, /@@unique\(\[shopHash, event, dedupeKey\]\)/);
  assert.match(migration, /CREATE INDEX "FunnelEvent_occurredAt_idx" ON "FunnelEvent"\("occurredAt"\);/);
  assert.match(migration, /CREATE UNIQUE INDEX "FunnelEvent_shopHash_event_dedupeKey_key"/);
  assert.match(schema, /model TelemetryPseudonymKeyFingerprint \{/);
  assert.match(compliance, /tx\.funnelEvent\.deleteMany/);
  assert.match(compliance, /tx\.onboardingProgress\.deleteMany/);
  assert.match(compliance, /tx\.reviewRequestState\.deleteMany/);
  assert.match(compliance, /tx\.growthState\.deleteMany/);
});

test("shop redact deletes current-key FunnelEvents, skips hash delete without a key, and fails fast on key mismatch", async () => {
  const matchingFingerprintStore = createFingerprintStore({
    existingFingerprint: fingerprintTelemetryPseudonymKey(pseudonymEnv),
  });
  const matching = createEraseShopDataPrisma({
    fingerprintStore: matchingFingerprintStore,
    funnelDeleteCount: 2,
  });

  const matchingResult = await eraseShopData({
    artifactStorage: {
      async delete() {
        return true;
      },
    },
    env: pseudonymEnv,
    prisma: matching.prisma,
    shopDomain: "example.myshopify.com",
  });

  assert.equal(matchingResult.deletedFunnelEvents, 2);
  assert.deepEqual(
    matching.deleted.find(([name]) => name === "funnelEvent"),
    ["funnelEvent", {
      where: {
        shopHash: hashShopDomain("example.myshopify.com", pseudonymEnv),
      },
    }],
  );

  const noKeyFingerprintStore = {
    async create() {
      throw new Error("fingerprint-store-should-not-be-used");
    },
    async findUnique() {
      throw new Error("fingerprint-store-should-not-be-used");
    },
  };
  const noKey = createEraseShopDataPrisma({
    fingerprintStore: noKeyFingerprintStore,
    funnelDeleteCount: 9,
  });
  const noKeyResult = await eraseShopData({
    artifactStorage: {
      async delete() {
        return true;
      },
    },
    env: { NODE_ENV: "development" },
    prisma: noKey.prisma,
    shopDomain: "example.myshopify.com",
  });

  assert.equal(noKeyResult.deletedFunnelEvents, 0);
  assert.equal(noKey.deleted.some(([name]) => name === "funnelEvent"), false);

  const deletedObjectKeys = [];
  const mismatched = createEraseShopDataPrisma({
    fingerprintStore: createFingerprintStore({
      existingFingerprint: fingerprintTelemetryPseudonymKey({
        TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 1).toString("base64"),
      }),
    }),
  });

  await assert.rejects(
    eraseShopData({
      artifactStorage: {
        async delete(objectKey) {
          deletedObjectKeys.push(objectKey);
          return true;
        },
      },
      env: pseudonymEnv,
      prisma: mismatched.prisma,
      shopDomain: "example.myshopify.com",
    }),
    /implicit key rotation is blocked/,
  );

  assert.deepEqual(deletedObjectKeys, []);
  assert.equal(mismatched.artifactFindManyCalled, false);
  assert.equal(mismatched.transactionRan, false);

  const missingFingerprint = createEraseShopDataPrisma({
    fingerprintStore: createFingerprintStore(),
  });
  missingFingerprint.setExistingFunnelEvent({ id: "funnel-existing" });

  await assert.rejects(
    eraseShopData({
      artifactStorage: {
        async delete(objectKey) {
          deletedObjectKeys.push(objectKey);
          return true;
        },
      },
      env: {
        TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 11).toString("base64"),
      },
      prisma: missingFingerprint.prisma,
      shopDomain: "example.myshopify.com",
    }),
    /fingerprint row is missing while FunnelEvent rows exist/,
  );

  assert.equal(missingFingerprint.artifactFindManyCalled, false);
  assert.equal(missingFingerprint.transactionRan, false);
});

test("growth routes delegate to app services and uninstall webhook separates snapshot from raw cleanup", () => {
  const onboardingRoute = readProjectFile("app/routes/app.growth.onboarding.ts");
  const reviewRoute = readProjectFile("app/routes/app.growth.review-request.ts");
  const summaryRoute = readProjectFile("app/routes/app.growth.funnel-summary.ts");
  const webhookHandler = readProjectFile("domain/webhooks/enqueue.server.ts");
  const funnelServer = readProjectFile("domain/growth/funnel.server.ts");
  const uninstallSnapshotSection = funnelServer.slice(
    funnelServer.indexOf("export async function recordUninstalledFunnelEvent"),
    funnelServer.indexOf("export async function deleteRawGrowthStateForShop"),
  );

  assert.match(onboardingRoute, /completeOnboardingStepAction/);
  assert.match(reviewRoute, /openReviewRequest/);
  assert.match(reviewRoute, /dismissReviewRequest/);
  assert.match(summaryRoute, /loadWeeklyFunnelSummary/);
  assert.match(
    webhookHandler,
    /await recordUninstalledFunnelEventBestEffort\(\{ shopDomain: shop \}\);\s+await deleteRawGrowthStateForShop\(\{ prismaClient: prisma, shopDomain: shop \}\);\s+await prisma\.session\.deleteMany/m,
  );
  assert.doesNotMatch(webhookHandler, /requireWebhookTelemetryConfiguration/);
  assert.doesNotMatch(webhookHandler, /requireTelemetryPseudonymKey/);
  assert.match(webhookHandler, /function emitWebhookTelemetryEvent/);
  assert.match(funnelServer, /export async function deleteRawGrowthStateForShop/);
  assert.match(funnelServer, /await tx\.onboardingProgress\.deleteMany\(\{/);
  assert.match(funnelServer, /await tx\.reviewRequestState\.deleteMany\(\{/);
  assert.match(funnelServer, /await tx\.growthState\.deleteMany\(\{/);
  assert.doesNotMatch(uninstallSnapshotSection, /onboardingProgress\.deleteMany/);
  assert.doesNotMatch(uninstallSnapshotSection, /reviewRequestState\.deleteMany/);
  assert.doesNotMatch(uninstallSnapshotSection, /growthState\.deleteMany/);
});

test("review request open rechecks entitlement and marks asked only with a conditional update", () => {
  const growthService = readProjectFile("app/services/growth.server.ts");

  assert.match(
    growthService,
    /const entitlement = await queryCurrentAppInstallationEntitlement\(authContext\.admin, \{\s+shopDomain,\s+\}\);/m,
  );
  assert.match(
    growthService,
    /entitlementState: entitlement\.state/,
  );
  assert.match(
    growthService,
    /await prisma\.reviewRequestState\.updateMany\(\{[\s\S]+dismissedPermanently: false,[\s\S]+OR: \[[\s\S]+\{ askedAt: null \},[\s\S]+\{ askedAt: \{ lte: askedAtCooldownCutoff \} \},/m,
  );
  assert.doesNotMatch(
    growthService,
    /dismissedPermanently:\s*false,\s*\n\s*}\s*,\s*\n\s*where: \{ shopDomain \}/m,
  );
  assert.match(growthService, /isMerchantCompletableOnboardingStepId\(stepId\)/);
});

test("weekly funnel summary is scoped to the authenticated current shop hash", () => {
  const growthService = readProjectFile("app/services/growth.server.ts");
  const funnelServer = readProjectFile("domain/growth/funnel.server.ts");
  const adr = readProjectFile("adr/0026-growth-kit-funnel-privacy-and-review-prompt.md");

  assert.match(
    growthService,
    /const authContext = await authenticateAndBootstrapShop\(request\);[\s\S]+resolveFunnelShopHash\(\{[\s\S]+shopDomain: authContext\.session\.shop,[\s\S]+\}\);/m,
  );
  assert.match(
    growthService,
    /queryWeeklyFunnelSummary\(\{ prismaClient: prisma, shopHash \}\)/,
  );
  assert.doesNotMatch(
    growthService,
    /queryWeeklyFunnelSummary\(\{ prismaClient: prisma \}\)/,
  );
  assert.match(
    funnelServer,
    /export async function queryWeeklyFunnelSummary\(\{[\s\S]+shopHash,[\s\S]+\}: \{[\s\S]+shopHash: string;[\s\S]+\}\)/m,
  );
  assert.match(
    funnelServer,
    /where: \{\s+shopHash,\s+occurredAt:/m,
  );
  assert.match(adr, /returns only that shop's weekly funnel counts/);
  assert.match(adr, /does not add an internal-secret app route for all-shop aggregation/);
});

test("funnel once recording and activated onboarding repair rely on durable idempotency", () => {
  const funnelServer = readProjectFile("domain/growth/funnel.server.ts");

  assert.doesNotMatch(funnelServer, /findExistingFunnelEvent/);
  assert.doesNotMatch(funnelServer, /isPrismaUniqueError/);
  assert.match(funnelServer, /const DEFAULT_ONCE_DEDUPE_KEY = "once"/);
  assert.match(
    funnelServer,
    /await prismaClient\.funnelEvent\.createMany\(\{[\s\S]+dedupeKey,[\s\S]+event: input\.event,[\s\S]+shopHash,[\s\S]+skipDuplicates: true,/m,
  );
  assert.match(funnelServer, /created\.count === 1[\s\S]+reason: "duplicate"/m);
  assert.match(
    funnelServer,
    /const shopHash = resolveFunnelShopHash\(\{ env, shopDomain \}\);[\s\S]+await assertTelemetryPseudonymKeyFingerprint\(\{ env, prismaClient \}\);[\s\S]+return prismaClient\.\$transaction\(async \(tx\) => \{/m,
  );
  assert.match(
    funnelServer,
    /await tx\.onboardingProgress\.createMany\(\{[\s\S]+skipDuplicates: true,/m,
  );
  assert.match(
    funnelServer,
    /if \(progressCreated\) \{[\s\S]+event: "onboarding_step_completed"[\s\S]+\n\s{4}\}\n\n\s{4}if \(stepId === "activated"\) \{/m,
  );
  assert.match(
    funnelServer,
    /await tx\.growthState\.createMany\(\{[\s\S]+activatedAt: completedAt,[\s\S]+skipDuplicates: true,/m,
  );
  assert.match(
    funnelServer,
    /await tx\.growthState\.updateMany\(\{[\s\S]+activatedAt: null,[\s\S]+shopDomain,[\s\S]+\}\);/m,
  );
  assert.match(
    funnelServer,
    /await recordFunnelEventOnce\(\{[\s\S]+event: "activated",[\s\S]+prismaClient: tx,/m,
  );
});

test("growth best-effort logs use telemetry instead of raw shop domains", () => {
  const telemetryService = readProjectFile("app/services/growth-telemetry.server.ts");
  const billingService = readProjectFile("app/services/billing.server.ts");
  const authBootstrap = readProjectFile("app/services/auth-bootstrap.server.ts");
  const appShell = readProjectFile("app/services/app-shell.server.ts");

  assert.match(telemetryService, /createTelemetry\(\{\s+service: "web",\s+\}\)/m);
  assert.match(telemetryService, /growthTelemetry\.emitEvent\(\{[\s\S]+shopDomain,[\s\S]+\}\);/m);
  assert.doesNotMatch(telemetryService, /console\.error\([\s\S]+shopDomain/);
  assert.match(billingService, /event: "growth\.entitlement_state\.remember_failed"/);
  assert.match(billingService, /event: "growth\.plan_selection_viewed\.record_failed"/);
  assert.match(authBootstrap, /event: "growth\.installed\.record_failed"/);
  assert.match(appShell, /event: "growth\.home_data\.load_failed"/);
  assert.doesNotMatch(
    billingService,
    /console\.error\("Failed to (remember growth entitlement state|record plan selection viewed funnel event)"[\s\S]+shopDomain/m,
  );
  assert.doesNotMatch(
    authBootstrap,
    /console\.error\("Failed to record installed funnel event after authentication"[\s\S]+shopDomain/m,
  );
  assert.doesNotMatch(
    appShell,
    /console\.error\("Failed to load growth home data"[\s\S]+shopDomain/m,
  );
});

test("review prompt copy remains neutral and dismissible", () => {
  const copy = readProjectFile("app/utils/admin-copy.ts");
  const homeRoute = readProjectFile("app/routes/app._index.tsx");

  assert.match(copy, /投稿内容や投稿有無による特典はありません/);
  assert.match(copy, /reviewDismissLabel: "今後表示しない"/);
  assert.doesNotMatch(copy, /高評価|星5|割引|クーポン/);
  assert.match(homeRoute, /reviewFetcher\.submit/);
  assert.match(homeRoute, /GROWTH_COPY\.reviewDismissLabel/);
});
