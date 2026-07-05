import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import {
  queryPartnerApiBillingEntitlement,
  type BillingEntitlement,
} from "./billing.server";
import { loadGrowthHomeData, type GrowthHomeData } from "./growth.server";
import { logGrowthBestEffortFailure } from "./growth-telemetry.server";

export async function loadEmbeddedAppShell({ request }: LoaderFunctionArgs) {
  await authenticateAndBootstrapShop(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
}

export type AppHomeLoaderData = {
  entitlement: BillingEntitlement | null;
  growth: GrowthHomeData | null;
};

async function loadGrowthHomeDataGracefully({
  entitlement,
  shopDomain,
}: {
  entitlement: BillingEntitlement | null;
  shopDomain: string;
}) {
  try {
    return await loadGrowthHomeData({
      entitlement,
      shopDomain,
    });
  } catch (error) {
    logGrowthBestEffortFailure({
      error,
      event: "growth.home_data.load_failed",
      shopDomain,
    });

    return null;
  }
}

export async function loadAppHome({ request }: LoaderFunctionArgs): Promise<AppHomeLoaderData> {
  const authContext = await authenticateAndBootstrapShop(request);

  try {
    const entitlement = await queryPartnerApiBillingEntitlement({
      shopDomain: authContext.session.shop,
    });

    return {
      entitlement,
      growth: await loadGrowthHomeDataGracefully({
        entitlement,
        shopDomain: authContext.session.shop,
      }),
    };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    console.error("Failed to load billing entitlement for app home", {
      error,
      shopDomain: authContext.session.shop,
    });

    return {
      entitlement: null,
      growth: await loadGrowthHomeDataGracefully({
        entitlement: null,
        shopDomain: authContext.session.shop,
      }),
    };
  }
}

export async function redirectAppHome({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const target = new URL("/app", url);

  target.search = url.search;
  throw redirect(`${target.pathname}${target.search}`);
}
