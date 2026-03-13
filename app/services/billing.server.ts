import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import { deriveCurrentInstallationEntitlement } from "~/domain/billing/current-installation.mjs";
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
};

async function readCurrentBillingEntitlement(request: Request): Promise<BillingEntitlement> {
  const authContext = await authenticateAndBootstrapShop(request);

  return queryCurrentAppInstallationEntitlement(authContext.admin, {
    shopDomain: authContext.session.shop,
  });
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

  return {
    ...entitlement,
    checkedAt: new Date().toISOString(),
  };
}

export async function loadPricingGate({ request }: LoaderFunctionArgs): Promise<BillingGateLoaderData> {
  return {
    entitlement: await readCurrentBillingEntitlement(request),
  };
}

export async function loadWelcomeGate({ request }: LoaderFunctionArgs): Promise<BillingGateLoaderData> {
  const entitlement = await readCurrentBillingEntitlement(request);

  if (entitlement.state === "ACTIVE_PAID") {
    throw redirect("/app");
  }

  return {
    entitlement,
  };
}

export async function loadBillingRefresh({ request }: LoaderFunctionArgs) {
  const entitlement = await readCurrentBillingEntitlement(request);

  return Response.json(entitlement);
}
