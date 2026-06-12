import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import {
  queryCurrentAppInstallationEntitlement,
  type BillingEntitlement,
} from "./billing.server";

export async function loadEmbeddedAppShell({ request }: LoaderFunctionArgs) {
  await authenticateAndBootstrapShop(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
}

export type AppHomeLoaderData = {
  entitlement: BillingEntitlement | null;
};

export async function loadAppHome({ request }: LoaderFunctionArgs): Promise<AppHomeLoaderData> {
  const authContext = await authenticateAndBootstrapShop(request);

  try {
    return {
      entitlement: await queryCurrentAppInstallationEntitlement(authContext.admin, {
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

    return { entitlement: null };
  }
}

export async function redirectAppHome({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const target = new URL("/app", url);

  target.search = url.search;
  throw redirect(`${target.pathname}${target.search}`);
}
