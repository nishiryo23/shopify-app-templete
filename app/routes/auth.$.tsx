import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { runAuthLoader } from "~/app/services/auth.server";

export const loader = (args: LoaderFunctionArgs) => runAuthLoader(args);

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
