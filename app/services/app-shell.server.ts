import type { LoaderFunctionArgs } from "react-router";

import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";

export async function loadEmbeddedAppShell({ request }: LoaderFunctionArgs) {
  await authenticateAndBootstrapShop(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
}
