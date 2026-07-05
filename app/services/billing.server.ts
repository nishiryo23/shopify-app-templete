import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import prisma from "../db.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import { logGrowthBestEffortFailure } from "./growth-telemetry.server";
import { resolveBillingEntitlement } from "~/domain/billing/entitlement-resolver.mjs";
import { derivePlanSelectionUrl } from "~/domain/billing/managed-pricing-url.mjs";
import { createPartnerApiClient } from "~/domain/billing/partner-api-client.mjs";
import {
  buildPaidPlanHandleAllowlist,
  normalizePlanHandle,
} from "~/domain/billing/partner-entitlement.mjs";
import {
  recordPlanSelectionViewed,
  rememberEntitlementState,
} from "~/domain/growth/funnel.server";

type EntitlementState =
  | "ACTIVE_PAID"
  | "PENDING_APPROVAL"
  | "PAYMENT_HOLD"
  | "NOT_ENTITLED";

type ResolvedBillingEntitlement = {
  activeItemHandles: string[];
  checkedAt: string | null;
  currentBillingCycle: unknown | null;
  hasActiveSubscription: boolean;
  legacySubscriptionId: string | null;
  pendingUpdate: unknown | null;
  planHandle: string | null;
  price: unknown | null;
  state: string;
  trialEndsAt: string | null;
};

export type BillingEntitlement = {
  activeItemHandles: string[];
  checkedAt: string;
  currentBillingCycle: unknown | null;
  hasActiveSubscription: boolean;
  legacySubscriptionId: string | null;
  pendingUpdate: unknown | null;
  planHandle: string | null;
  price: unknown | null;
  state: EntitlementState;
  trialEndsAt: string | null;
};

export type BillingGateLoaderData = {
  entitlement: BillingEntitlement;
  planSelectionUrl: string | null;
};

const SHOP_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MYSHOPIFY_SUFFIX = ".myshopify.com";

function normalizeShopDomain(value: string) {
  return value.trim().toLowerCase();
}

function normalizeReturnedShopParameter(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.endsWith(MYSHOPIFY_SUFFIX)) {
    return normalized;
  }

  return SHOP_HANDLE_PATTERN.test(normalized) ? `${normalized}${MYSHOPIFY_SUFFIX}` : null;
}

function isPlanSelectionReturnForShop(request: Request, shopDomain: string) {
  const url = new URL(request.url);
  const returnedPlanHandle = normalizePlanHandle(url.searchParams.get("plan_handle"));
  const returnedShop = normalizeReturnedShopParameter(url.searchParams.get("shop"));

  return Boolean(returnedPlanHandle && returnedShop === normalizeShopDomain(shopDomain));
}

function isEntitlementState(value: string): value is EntitlementState {
  return (
    value === "ACTIVE_PAID"
    || value === "PENDING_APPROVAL"
    || value === "PAYMENT_HOLD"
    || value === "NOT_ENTITLED"
  );
}

function normalizeResolvedBillingEntitlement(
  entitlement: ResolvedBillingEntitlement,
): BillingEntitlement {
  if (!entitlement.checkedAt) {
    throw new Error("Billing entitlement resolver returned no checkedAt timestamp.");
  }

  if (!isEntitlementState(entitlement.state)) {
    throw new Error(`Billing entitlement resolver returned unknown state: ${entitlement.state}`);
  }

  return {
    activeItemHandles: entitlement.activeItemHandles,
    checkedAt: entitlement.checkedAt,
    currentBillingCycle: entitlement.currentBillingCycle,
    hasActiveSubscription: entitlement.hasActiveSubscription,
    legacySubscriptionId: entitlement.legacySubscriptionId,
    pendingUpdate: entitlement.pendingUpdate,
    planHandle: entitlement.planHandle,
    price: entitlement.price,
    state: entitlement.state,
    trialEndsAt: entitlement.trialEndsAt,
  };
}

async function rememberEntitlementStateBestEffort({
  entitlement,
  shopDomain,
}: {
  entitlement: BillingEntitlement;
  shopDomain: string;
}) {
  try {
    await rememberEntitlementState({
      checkedAt: new Date(entitlement.checkedAt),
      entitlementState: entitlement.state,
      prismaClient: prisma,
      shopDomain,
      subscriptionNamePresent: Boolean(entitlement.planHandle),
      subscriptionStatus: null,
    });
  } catch (error) {
    logGrowthBestEffortFailure({
      error,
      event: "growth.entitlement_state.remember_failed",
      shopDomain,
    });
  }
}

async function recordPlanSelectionViewedBestEffort({
  entitlement,
  hasPlanSelectionUrl,
  shopDomain,
}: {
  entitlement: BillingEntitlement;
  hasPlanSelectionUrl: boolean;
  shopDomain: string;
}) {
  try {
    await recordPlanSelectionViewed({
      entitlementState: entitlement.state,
      hasPlanSelectionUrl,
      prismaClient: prisma,
      shopDomain,
    });
  } catch (error) {
    logGrowthBestEffortFailure({
      error,
      event: "growth.plan_selection_viewed.record_failed",
      shopDomain,
    });
  }
}

async function readCurrentBillingEntitlement(request: Request): Promise<BillingEntitlement> {
  const authContext = await authenticateAndBootstrapShop(request);

  return queryPartnerApiBillingEntitlement({
    shopDomain: authContext.session.shop,
  });
}

async function readCurrentBillingGate(
  request: Request,
  {
    forceRefreshOnPlanSelectionReturn = false,
    recordPlanSelectionView = false,
  }: {
    forceRefreshOnPlanSelectionReturn?: boolean;
    recordPlanSelectionView?: boolean;
  } = {},
): Promise<BillingGateLoaderData> {
  const authContext = await authenticateAndBootstrapShop(request);
  const entitlement = await queryPartnerApiBillingEntitlement({
    forceRefresh: forceRefreshOnPlanSelectionReturn
      && isPlanSelectionReturnForShop(request, authContext.session.shop),
    shopDomain: authContext.session.shop,
  });
  const planSelectionUrl = derivePlanSelectionUrl({
    appHandle: process.env.SHOPIFY_APP_HANDLE,
    shopDomain: authContext.session.shop,
  });

  if (recordPlanSelectionView) {
    await recordPlanSelectionViewedBestEffort({
      entitlement,
      hasPlanSelectionUrl: Boolean(planSelectionUrl),
      shopDomain: authContext.session.shop,
    });
  }

  return {
    entitlement,
    planSelectionUrl,
  };
}

export async function queryPartnerApiBillingEntitlement(
  {
    allowStaleFallback = true,
    logger = console,
    forceRefresh = false,
    shopDomain,
  }: {
    allowStaleFallback?: boolean;
    forceRefresh?: boolean;
    logger?: typeof console;
    shopDomain: string;
  },
): Promise<BillingEntitlement> {
  const normalizedShopDomain = normalizeShopDomain(shopDomain);
  const shopSnapshot = await prisma.shop.findUnique({
    select: { shopGid: true },
    where: { shopDomain: normalizedShopDomain },
  });

  if (!shopSnapshot?.shopGid) {
    throw new Error("Shop GID snapshot is required before Partner API billing refresh.");
  }

  const entitlement = normalizeResolvedBillingEntitlement(await resolveBillingEntitlement({
    allowStaleFallback,
    forceRefresh,
    logger,
    paidPlanHandles: buildPaidPlanHandleAllowlist({
      testPlanHandlesEnv: process.env.BILLING_TEST_PLAN_HANDLES,
    }),
    partnerApiClient: createPartnerApiClient({
      accessToken: process.env.PARTNER_API_ACCESS_TOKEN,
      organizationId: process.env.PARTNER_API_ORG_ID,
    }),
    partnerAppId: process.env.SHOPIFY_APP_GID,
    partnerShopId: shopSnapshot.shopGid,
    prismaClient: prisma,
    shopDomain: normalizedShopDomain,
  }));

  await rememberEntitlementStateBestEffort({
    entitlement,
    shopDomain: normalizedShopDomain,
  });

  return entitlement;
}

export async function loadPricingGate({ request }: LoaderFunctionArgs): Promise<BillingGateLoaderData> {
  return readCurrentBillingGate(request, { recordPlanSelectionView: true });
}

export async function loadWelcomeGate({ request }: LoaderFunctionArgs): Promise<BillingGateLoaderData> {
  const gate = await readCurrentBillingGate(request, {
    forceRefreshOnPlanSelectionReturn: true,
  });
  const { entitlement } = gate;

  if (entitlement.state === "ACTIVE_PAID") {
    throw redirect("/app");
  }

  return gate;
}

export async function loadBillingRefresh({ request }: LoaderFunctionArgs) {
  const entitlement = await readCurrentBillingEntitlement(request);

  return Response.json(entitlement);
}
