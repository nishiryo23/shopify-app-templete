import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { login } from "../shopify.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";

export async function runAuthLoader({ request }: LoaderFunctionArgs) {
  await authenticateAndBootstrapShop(request);
  return null;
}

export async function runAuthLoginLoader({ request }: LoaderFunctionArgs) {
  return request.method === "HEAD" ? null : login(request);
}

export async function runAuthLoginAction({ request }: ActionFunctionArgs) {
  return login(request);
}
