import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import prisma from "../db.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import { logGrowthBestEffortFailure } from "./growth-telemetry.server";
import { deriveCurrentInstallationEntitlement } from "~/domain/billing/current-installation.mjs";
import { derivePlanSelectionUrl } from "~/domain/billing/managed-pricing-url.mjs";
import {
  recordPlanSelectionViewed,
  rememberEntitlementState,
} from "~/domain/growth/funnel.server";
import { queryCurrentAppInstallation } from "~/platform/shopify/current-app-installation.server";

type DerivedBillingEntitlement = ReturnType<typeof deriveCurrentInstallationEntitlement>;

type MultipleActiveSubscriptionDetails = {
  activeSubscriptionCount: number;
  statuses: Array<string | null>;
  subscriptionIds: Array<string | null>;
};

type FallbackSubscriptionDetails = {
  fallbackStatus: string | null;
  isTerminal: boolean | null;
  subscriptionId: string | null;
};

export type BillingEntitlement = Omit<DerivedBillingEntitlement, "checkedAt"> & {
  checkedAt: string;
};

export type BillingGateLoaderData = {
  entitlement: BillingEntitlement;
  planSelectionUrl: string | null;
};

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
      subscriptionNamePresent: Boolean(entitlement.subscriptionName),
      subscriptionStatus: entitlement.sourceStatus,
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

  return queryCurrentAppInstallationEntitlement(authContext.admin, {
    shopDomain: authContext.session.shop,
  });
}

async function readCurrentBillingGate(
  request: Request,
  { recordPlanSelectionView = false }: { recordPlanSelectionView?: boolean } = {},
): Promise<BillingGateLoaderData> {
  const authContext = await authenticateAndBootstrapShop(request);
  const entitlement = await queryCurrentAppInstallationEntitlement(authContext.admin, {
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

export async function queryCurrentAppInstallationEntitlement(
  admin: Parameters<typeof queryCurrentAppInstallation>[0],
  {
    logger = console,
    shopDomain,
  }: {
    logger?: Pick<typeof console, "warn">;
    shopDomain?: string;
  } = {},
): Promise<BillingEntitlement> {
  const data = await queryCurrentAppInstallation(admin);
  const entitlement = deriveCurrentInstallationEntitlement(data.currentAppInstallation, {
    logMultipleActiveSubscriptions(details: MultipleActiveSubscriptionDetails) {
      logger.warn("Detected multiple active Shopify app subscriptions; using first subscription.", {
        ...details,
        shopDomain: shopDomain ?? null,
      });
    },
    logFallbackSubscriptionSelection(details: FallbackSubscriptionDetails) {
      logger.warn("Falling back to latest Shopify app subscription because activeSubscriptions is empty.", {
        ...details,
        shopDomain: shopDomain ?? null,
      });
    },
  });

  const checkedAt = new Date();
  const entitlementResult = {
    ...entitlement,
    checkedAt: checkedAt.toISOString(),
  };

  if (shopDomain) {
    await rememberEntitlementStateBestEffort({
      entitlement: entitlementResult,
      shopDomain,
    });
  }

  return entitlementResult;
}

export async function loadPricingGate({ request }: LoaderFunctionArgs): Promise<BillingGateLoaderData> {
  return readCurrentBillingGate(request, { recordPlanSelectionView: true });
}

export async function loadWelcomeGate({ request }: LoaderFunctionArgs): Promise<BillingGateLoaderData> {
  const gate = await readCurrentBillingGate(request);
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
