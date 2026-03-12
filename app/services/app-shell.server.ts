import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

export async function loadEmbeddedAppShell({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
}
