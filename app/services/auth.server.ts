import type { LoaderFunctionArgs } from "react-router";

import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";

export async function runAuthLoader({ request }: LoaderFunctionArgs) {
  await authenticateAndBootstrapShop(request);
  return null;
}
