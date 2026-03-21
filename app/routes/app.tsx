import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { loadEmbeddedAppShell } from "~/app/services/app-shell.server";

export const loader = (args: LoaderFunctionArgs) => loadEmbeddedAppShell(args);

export default function AppShell() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">ホーム</s-link>
        <s-link href="/app/preview">プレビュー</s-link>
        <s-link href="/app/pricing">料金</s-link>
        <s-link href="/app/welcome">利用開始</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
