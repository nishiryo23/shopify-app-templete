import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";

export async function loadEmbeddedAppShell({ request }: LoaderFunctionArgs) {
  await authenticateAndBootstrapShop(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
}

export async function redirectAppHome({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const target = new URL("/app", url);

  target.search = url.search;
  throw redirect(`${target.pathname}${target.search}`);
}
