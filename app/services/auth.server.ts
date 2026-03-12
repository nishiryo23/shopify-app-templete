import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

export async function runAuthLoader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}
