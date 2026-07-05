import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ENTITLEMENT_STATES,
  isTerminalSubscriptionStatus,
  mapAllowlistedSubscriptionStatusToEntitlement,
} from "../../domain/billing/entitlement-state.mjs";
import {
  buildPaidPlanHandleAllowlist,
  derivePartnerApiEntitlement,
  normalizePlanHandle,
  parseBillingTestPlanHandles,
} from "../../domain/billing/partner-entitlement.mjs";
import {
  BILLING_ENTITLEMENT_SNAPSHOT_TTL_MS,
  resolveBillingEntitlement,
} from "../../domain/billing/entitlement-resolver.mjs";
import {
  ACTIVE_SUBSCRIPTION_QUERY,
  buildPartnerApiGraphqlEndpoint,
  createPartnerApiClient,
} from "../../domain/billing/partner-api-client.mjs";

const shopDomain = "example.myshopify.com";
const partnerAppId = "gid://shopify/App/123";
const partnerShopId = "gid://shopify/Shop/456";
const rootDir = path.resolve(import.meta.dirname, "../..");
const officialFlatRatePrice = Object.freeze({
  __typename: "FlatRatePrice",
  active: true,
  amount: "10.00",
  currency: "USD",
});

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

function createOfficialActiveSubscription(overrides = {}) {
  return {
    currentBillingCycle: {
      endTime: "2026-08-05T00:00:00.000Z",
      startTime: "2026-07-05T00:00:00.000Z",
    },
    items: [{
      handle: "standard",
      price: officialFlatRatePrice,
    }],
    legacySubscriptionId: "gid://shopify/AppSubscription/refreshed",
    pendingUpdate: {
      billingPeriod: "EVERY_30_DAYS",
      items: [{ handle: "standard" }],
      legacySubscriptionId: "gid://shopify/AppSubscription/pending",
    },
    trialEndsAt: null,
    ...overrides,
  };
}

function createSnapshot(overrides = {}) {
  return {
    activeItemHandles: ["standard"],
    checkedAt: new Date("2026-07-05T00:00:00.000Z"),
    createdAt: new Date("2026-07-05T00:00:00.000Z"),
    currentBillingCycle: null,
    entitlementState: ENTITLEMENT_STATES.ACTIVE_PAID,
    hasActiveSubscription: true,
    legacySubscriptionId: "gid://shopify/AppSubscription/standard",
    pendingUpdate: null,
    partnerAppId,
    partnerShopId,
    planHandle: "standard",
    price: officialFlatRatePrice,
    shopDomain,
    trialEndsAt: null,
    updatedAt: new Date("2026-07-05T00:00:00.000Z"),
    ...overrides,
  };
}

function createPrismaSnapshotStore(initialSnapshot = null) {
  const calls = [];
  let storedSnapshot = initialSnapshot;

  return {
    calls,
    get snapshot() {
      return storedSnapshot;
    },
    billingEntitlementSnapshot: {
      async findUnique({ where }) {
        calls.push({ method: "findUnique", where });
        return storedSnapshot?.shopDomain === where.shopDomain ? storedSnapshot : null;
      },
      async upsert({ create, update, where }) {
        calls.push({ create, method: "upsert", update, where });
        storedSnapshot = {
          ...(storedSnapshot?.shopDomain === where.shopDomain ? storedSnapshot : create),
          ...update,
          createdAt: storedSnapshot?.createdAt ?? create.createdAt ?? new Date("2026-07-05T00:00:00.000Z"),
          shopDomain: where.shopDomain,
          updatedAt: new Date("2026-07-05T00:00:00.000Z"),
        };
        return storedSnapshot;
      },
      async updateMany({ data, where }) {
        calls.push({ data, method: "updateMany", where });

        if (
          storedSnapshot?.shopDomain !== where.shopDomain
          || storedSnapshot.checkedAt.getTime() > where.checkedAt.lte.getTime()
        ) {
          return { count: 0 };
        }

        storedSnapshot = {
          ...storedSnapshot,
          ...data,
          updatedAt: new Date("2026-07-05T00:00:00.000Z"),
        };

        return { count: 1 };
      },
    },
  };
}

function createPartnerApiFixtureClient(activeSubscription, calls = []) {
  return {
    async queryActiveSubscription(input) {
      calls.push(input);
      return activeSubscription;
    },
  };
}

test("allowlisted plan status mapping is applied only after plan handle allowlist passes", () => {
  assert.equal(
    mapAllowlistedSubscriptionStatusToEntitlement("ACTIVE"),
    ENTITLEMENT_STATES.ACTIVE_PAID,
  );
  assert.equal(
    mapAllowlistedSubscriptionStatusToEntitlement("PENDING"),
    ENTITLEMENT_STATES.PENDING_APPROVAL,
  );
  assert.equal(
    mapAllowlistedSubscriptionStatusToEntitlement("ACCEPTED"),
    ENTITLEMENT_STATES.PENDING_APPROVAL,
  );
  assert.equal(isTerminalSubscriptionStatus("ACCEPTED"), false);
  assert.equal(
    mapAllowlistedSubscriptionStatusToEntitlement("FROZEN"),
    ENTITLEMENT_STATES.PAYMENT_HOLD,
  );

  for (const status of ["CANCELLED", "DECLINED", "EXPIRED"]) {
    assert.equal(
      mapAllowlistedSubscriptionStatusToEntitlement(status),
      ENTITLEMENT_STATES.NOT_ENTITLED,
    );
    assert.equal(isTerminalSubscriptionStatus(status), true);
  }
});

test("plan handle allowlist controls paid entitlement and status alone cannot grant paid access", () => {
  const paidPlanHandles = buildPaidPlanHandleAllowlist({
    testPlanHandlesEnv: "private-test-standard, pro_plan",
  });

  assert.deepEqual([...paidPlanHandles].sort(), ["private-test-standard", "pro_plan", "standard"]);
  assert.deepEqual(parseBillingTestPlanHandles("alpha, beta-plan, pro_plan"), ["alpha", "beta-plan", "pro_plan"]);
  assert.throws(
    () => parseBillingTestPlanHandles("invalid handle"),
    /Invalid BILLING_TEST_PLAN_HANDLES entry/,
  );

  assert.equal(
    derivePartnerApiEntitlement(
      { legacySubscriptionId: "sub-1", items: [{ handle: "standard" }] },
      { paidPlanHandles },
    ).state,
    ENTITLEMENT_STATES.ACTIVE_PAID,
  );
  assert.equal(
    derivePartnerApiEntitlement(
      { legacySubscriptionId: "sub-2", items: [{ handle: "private-test-standard" }] },
      { paidPlanHandles },
    ).state,
    ENTITLEMENT_STATES.ACTIVE_PAID,
  );
  assert.equal(
    derivePartnerApiEntitlement(
      { legacySubscriptionId: "sub-3", items: [{ handle: "free" }] },
      { paidPlanHandles },
    ).state,
    ENTITLEMENT_STATES.NOT_ENTITLED,
    "an activeSubscription without an allowlisted item handle must not become paid",
  );
  assert.equal(
    derivePartnerApiEntitlement(null, { paidPlanHandles }).state,
    ENTITLEMENT_STATES.NOT_ENTITLED,
  );
});

test("plan_handle, Partner API item handles, and BILLING_TEST_PLAN_HANDLES share underscore normalization", () => {
  const billingService = readProjectFile("app/services/billing.server.ts");
  const paidPlanHandles = buildPaidPlanHandleAllowlist({
    publicPlanHandles: ["standard"],
    testPlanHandlesEnv: "pro_plan",
  });
  const entitlement = derivePartnerApiEntitlement(
    {
      items: [{ handle: "Pro_Plan" }],
      legacySubscriptionId: "gid://shopify/AppSubscription/pro-plan",
    },
    { paidPlanHandles },
  );

  assert.equal(normalizePlanHandle("Pro_Plan"), "pro_plan");
  assert.deepEqual(parseBillingTestPlanHandles("pro_plan"), ["pro_plan"]);
  assert.equal(entitlement.state, ENTITLEMENT_STATES.ACTIVE_PAID);
  assert.equal(entitlement.planHandle, "pro_plan");
  assert.match(
    billingService,
    /const returnedPlanHandle = normalizePlanHandle\(url\.searchParams\.get\("plan_handle"\)\);/,
  );
});

test("resolver reads DB snapshot inside TTL without calling Partner API", async () => {
  const prismaClient = createPrismaSnapshotStore(createSnapshot());
  const partnerApiCalls = [];
  const entitlement = await resolveBillingEntitlement({
    now: new Date("2026-07-05T00:09:59.000Z"),
    paidPlanHandles: buildPaidPlanHandleAllowlist(),
    partnerApiClient: createPartnerApiFixtureClient(null, partnerApiCalls),
    partnerAppId,
    partnerShopId,
    prismaClient,
    shopDomain,
  });

  assert.equal(entitlement.state, ENTITLEMENT_STATES.ACTIVE_PAID);
  assert.equal(entitlement.checkedAt, "2026-07-05T00:00:00.000Z");
  assert.deepEqual(partnerApiCalls, []);
  assert.equal(BILLING_ENTITLEMENT_SNAPSHOT_TTL_MS, 10 * 60 * 1000);
});

test("resolver refreshes stale snapshot through Partner API and writes the DB snapshot", async () => {
  const prismaClient = createPrismaSnapshotStore(createSnapshot({
    checkedAt: new Date("2026-07-05T00:00:00.000Z"),
    entitlementState: ENTITLEMENT_STATES.NOT_ENTITLED,
    planHandle: "free",
  }));
  const partnerApiCalls = [];
  const entitlement = await resolveBillingEntitlement({
    now: new Date("2026-07-05T00:11:00.000Z"),
    paidPlanHandles: buildPaidPlanHandleAllowlist(),
    partnerApiClient: createPartnerApiFixtureClient(createOfficialActiveSubscription(), partnerApiCalls),
    partnerAppId,
    partnerShopId,
    prismaClient,
    shopDomain,
  });

  assert.equal(entitlement.state, ENTITLEMENT_STATES.ACTIVE_PAID);
  assert.equal(entitlement.planHandle, "standard");
  assert.equal(entitlement.checkedAt, "2026-07-05T00:11:00.000Z");
  assert.equal(entitlement.legacySubscriptionId, "gid://shopify/AppSubscription/refreshed");
  assert.deepEqual(partnerApiCalls, [{ appId: partnerAppId, shopId: partnerShopId }]);
  assert.equal(prismaClient.snapshot.entitlementState, ENTITLEMENT_STATES.ACTIVE_PAID);
  assert.equal(prismaClient.snapshot.legacySubscriptionId, "gid://shopify/AppSubscription/refreshed");
  assert.equal(prismaClient.snapshot.planHandle, "standard");
  assert.deepEqual(prismaClient.snapshot.currentBillingCycle, {
    endTime: "2026-08-05T00:00:00.000Z",
    startTime: "2026-07-05T00:00:00.000Z",
  });
  assert.deepEqual(prismaClient.snapshot.pendingUpdate, {
    billingPeriod: "EVERY_30_DAYS",
    items: [{ handle: "standard" }],
    legacySubscriptionId: "gid://shopify/AppSubscription/pending",
  });
  assert.deepEqual(prismaClient.snapshot.price, officialFlatRatePrice);
  assert.deepEqual(
    prismaClient.calls.filter((call) => call.method === "updateMany").map((call) => call.where),
    [{ checkedAt: { lte: new Date("2026-07-05T00:00:00.000Z") }, shopDomain }],
  );
});

test("resolver falls back to the latest snapshot when Partner API refresh fails", async () => {
  const prismaClient = createPrismaSnapshotStore(createSnapshot({
    checkedAt: new Date("2026-07-05T00:00:00.000Z"),
  }));
  const logs = [];
  const entitlement = await resolveBillingEntitlement({
    logger: {
      warn(message, details) {
        logs.push({ details, message });
      },
    },
    now: new Date("2026-07-05T00:11:00.000Z"),
    paidPlanHandles: buildPaidPlanHandleAllowlist(),
    partnerApiClient: {
      async queryActiveSubscription() {
        throw new Error("Partner API unavailable");
      },
    },
    partnerAppId,
    partnerShopId,
    prismaClient,
    shopDomain,
  });

  assert.equal(entitlement.state, ENTITLEMENT_STATES.ACTIVE_PAID);
  assert.equal(entitlement.checkedAt, "2026-07-05T00:00:00.000Z");
  assert.deepEqual(logs, [
    {
      details: {
        checkedAt: "2026-07-05T00:00:00.000Z",
        error: "Partner API unavailable",
        rateLimited: false,
        shopDomain,
      },
      message: "Falling back to cached billing entitlement snapshot after Partner API refresh failed.",
    },
  ]);
});

test("Partner API client fails fast when the access token is missing during refresh", async () => {
  const client = createPartnerApiClient({ accessToken: "", organizationId: "123456" });

  await assert.rejects(
    client.queryActiveSubscription({ appId: partnerAppId, shopId: partnerShopId }),
    /PARTNER_API_ACCESS_TOKEN is required/,
  );
});

test("Partner API client uses the official organization endpoint and X-Shopify token header", async () => {
  const fetchCalls = [];
  const client = createPartnerApiClient({
    accessToken: "partner-token",
    fetchImpl: async (endpoint, init) => {
      fetchCalls.push({ endpoint, init });

      return new Response(JSON.stringify({
        data: {
          activeSubscription: createOfficialActiveSubscription({
            legacySubscriptionId: "gid://shopify/AppSubscription/official",
          }),
        },
      }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
    organizationId: "987654",
  });

  const activeSubscription = await client.queryActiveSubscription({
    appId: partnerAppId,
    shopId: partnerShopId,
  });

  assert.equal(buildPartnerApiGraphqlEndpoint("987654"), "https://partners.shopify.com/987654/api/2026-07/graphql.json");
  assert.equal(fetchCalls[0].endpoint, "https://partners.shopify.com/987654/api/2026-07/graphql.json");
  assert.equal(fetchCalls[0].init.headers["X-Shopify-Access-Token"], "partner-token");
  assert.equal("Authorization" in fetchCalls[0].init.headers, false);
  const query = JSON.parse(fetchCalls[0].init.body).query;
  assert.match(query, /legacySubscriptionId/);
  assert.match(query, /currentBillingCycle\s*\{\s*startTime\s*endTime\s*\}/);
  assert.match(query, /pendingUpdate\s*\{\s*billingPeriod\s*items\s*\{\s*handle\s*\}\s*legacySubscriptionId\s*\}/);
  assert.match(query, /price\s*\{\s*__typename\s*active\s*currency\s*\.\.\. on FlatRatePrice\s*\{\s*amount\s*\}\s*\.\.\. on TieredPrice\s*\{\s*tiersMode\s*tiers\s*\{\s*upTo\s*amountPerUnit\s*amount\s*\}\s*\}/);
  assert.doesNotMatch(ACTIVE_SUBSCRIPTION_QUERY, /TieredPrice\s*\{\s*tiers\s*\}/);
  assert.doesNotMatch(ACTIVE_SUBSCRIPTION_QUERY, /plan\s*\{|\n\s+status\b|\n\s+name\b|\n\s+test\b|currentPeriodEnd/);
  assert.doesNotMatch(ACTIVE_SUBSCRIPTION_QUERY, /\bstartsAt\b|\bendsAt\b|\beffectiveAt\b|\bcurrencyCode\b/);
  assert.doesNotMatch(ACTIVE_SUBSCRIPTION_QUERY, /\n\s+id\s*\n/);
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body).variables, {
    appId: partnerAppId,
    shopId: partnerShopId,
  });
  assert.equal(activeSubscription.items[0].handle, "standard");
  assert.equal(activeSubscription.legacySubscriptionId, "gid://shopify/AppSubscription/official");
});

test("resolver identifies Partner API 429 and falls back to the latest snapshot", async () => {
  const prismaClient = createPrismaSnapshotStore(createSnapshot());
  const logs = [];
  const client = createPartnerApiClient({
    accessToken: "partner-token",
    fetchImpl: async () => new Response("", { status: 429 }),
    organizationId: "987654",
  });
  const entitlement = await resolveBillingEntitlement({
    logger: {
      warn(message, details) {
        logs.push({ details, message });
      },
    },
    now: new Date("2026-07-05T00:11:00.000Z"),
    paidPlanHandles: buildPaidPlanHandleAllowlist(),
    partnerApiClient: client,
    partnerAppId,
    partnerShopId,
    prismaClient,
    shopDomain,
  });

  assert.equal(entitlement.state, ENTITLEMENT_STATES.ACTIVE_PAID);
  assert.equal(logs[0].details.rateLimited, true);
});
