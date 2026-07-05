import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { derivePlanSelectionUrl } from "../../domain/billing/managed-pricing-url.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("billing service resolves entitlement through Partner API resolver and DB snapshot", () => {
  const service = readProjectFile("app/services/billing.server.ts");
  const schema = readProjectFile("prisma/schema.prisma");

  assert.match(service, /resolveBillingEntitlement/);
  assert.match(service, /createPartnerApiClient/);
  assert.match(service, /PARTNER_API_ACCESS_TOKEN/);
  assert.match(service, /PARTNER_API_ORG_ID/);
  assert.match(service, /SHOPIFY_APP_GID/);
  assert.match(service, /shopGid/);
  assert.match(service, /BILLING_TEST_PLAN_HANDLES/);
  assert.match(schema, /model BillingEntitlementSnapshot/);
  assert.match(schema, /legacySubscriptionId\s+String\?/);
  assert.match(schema, /shopGid\s+String\?/);
  assert.doesNotMatch(schema, /subscriptionId\s+String\?/);
  assert.doesNotMatch(service, /queryCurrentAppInstallation|currentAppInstallation|activeSubscriptions|allSubscriptions/);
});

test("billing refresh route delegates to shared billing loader", () => {
  const refreshRoute = readProjectFile("app/routes/app.billing.refresh.ts");

  assert.match(refreshRoute, /loadBillingRefresh/);
  assert.match(refreshRoute, /export const loader = \(args: LoaderFunctionArgs\) => loadBillingRefresh\(args\);/);
});

test("pricing route uses shared gate data and refresh endpoint", () => {
  const pricingRoute = readProjectFile("app/routes/app.pricing.tsx");

  assert.match(pricingRoute, /loadPricingGate/);
  assert.match(pricingRoute, /useFetcher/);
  assert.match(pricingRoute, /load\("\/app\/billing\/refresh"\)/);
  assert.match(pricingRoute, /Shopify の最新の契約状態をもとに表示しています/);
  assert.doesNotMatch(pricingRoute, /P-003 で pricing gate を実装する前の最小 shell/);
});

test("plan selection deep link derivation is guarded and trigger-only", () => {
  assert.equal(
    derivePlanSelectionUrl({ appHandle: "demo-app", shopDomain: "example.myshopify.com" }),
    "https://admin.shopify.com/store/example/charges/demo-app/pricing_plans",
  );
  assert.equal(
    derivePlanSelectionUrl({ appHandle: "", shopDomain: "example.myshopify.com" }),
    null,
    "missing app handle must hide the deep link",
  );
  assert.equal(
    derivePlanSelectionUrl({ appHandle: undefined, shopDomain: "example.myshopify.com" }),
    null,
    "unset SHOPIFY_APP_HANDLE must hide the deep link",
  );
  assert.equal(
    derivePlanSelectionUrl({ appHandle: "demo-app", shopDomain: "shop.example.com" }),
    null,
    "custom shop domains must hide the deep link",
  );
  assert.equal(
    derivePlanSelectionUrl({ appHandle: "demo app!", shopDomain: "example.myshopify.com" }),
    null,
    "invalid handles must not be interpolated into the admin URL",
  );

  const url = derivePlanSelectionUrl({ appHandle: "demo-app", shopDomain: "example.myshopify.com" });
  assert.doesNotMatch(url, /charge_id|\?/, "deep link must stay trigger-only without query shortcuts");
});

test("billing gate loaders expose the plan selection url from the service layer", () => {
  const service = readProjectFile("app/services/billing.server.ts");

  assert.match(service, /derivePlanSelectionUrl/);
  assert.match(service, /planSelectionUrl: string \| null/);
  assert.match(service, /SHOPIFY_APP_HANDLE/);
});

test("pricing route renders a guarded plan selection CTA with top-level navigation", () => {
  const pricingRoute = readProjectFile("app/routes/app.pricing.tsx");

  assert.match(pricingRoute, /data-testid="pricing-plan-selection-cta"/);
  assert.match(pricingRoute, /target="_top"/);
  assert.match(pricingRoute, /\{planSelectionUrl \? \(/, "CTA must not render without a derived URL");
  assert.match(pricingRoute, /getPlanSelectionCtaLabel/, "CTA label must come from admin copy");
});

test("welcome route redirects active paid shops and force-refreshes only plan selection returns", () => {
  const welcomeRoute = readProjectFile("app/routes/app.welcome.tsx");
  const service = readProjectFile("app/services/billing.server.ts");

  assert.match(welcomeRoute, /loadWelcomeGate/);
  assert.match(service, /if \(entitlement\.state === "ACTIVE_PAID"\) \{\s+throw redirect\("\/app"\);/m);
  assert.match(service, /forceRefreshOnPlanSelectionReturn: true/);
  assert.match(service, /plan_handle/);
  assert.match(service, /normalizeReturnedShopParameter/);
  assert.match(welcomeRoute, /この画面を開いただけでは契約は有効になりません/);
  assert.doesNotMatch(`${service}\n${welcomeRoute}`, /charge_id/);
});

test("billing runtime has no residual currentAppInstallation entitlement reference", () => {
  const billingRuntimeFiles = [
    "app/services/app-shell.server.ts",
    "app/services/billing.server.ts",
    "app/services/growth.server.ts",
    "domain/billing/entitlement-resolver.mjs",
    "domain/billing/entitlement-state.mjs",
    "domain/billing/managed-pricing-url.mjs",
    "domain/billing/partner-api-client.mjs",
    "domain/billing/partner-entitlement.mjs",
  ];

  for (const relativePath of billingRuntimeFiles) {
    assert.doesNotMatch(
      readProjectFile(relativePath),
      /currentAppInstallation|queryCurrentAppInstallation|activeSubscriptions|allSubscriptions/,
      `${relativePath} must not retain deprecated billing truth`,
    );
  }
});

test("review request open path requires live Partner API entitlement without stale fallback", () => {
  const growthService = readProjectFile("app/services/growth.server.ts");
  const adr = readProjectFile("adr/0027-partner-api-billing-entitlement-truth.md");

  assert.match(
    growthService,
    /queryPartnerApiBillingEntitlement\(\{\s+allowStaleFallback: false,\s+forceRefresh: true,\s+shopDomain,/m,
  );
  assert.match(
    growthService,
    /catch \(error\) \{[\s\S]+throw redirect\("\/app"\);[\s\S]+\}/m,
  );
  assert.match(adr, /review prompt gate/);
});
