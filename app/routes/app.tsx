import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import jaTranslations from "@shopify/polaris/locales/ja.json";
import { boundary } from "@shopify/shopify-app-react-router/server";
import "@shopify/polaris/build/esm/styles.css";

import { loadEmbeddedAppShell } from "~/app/services/app-shell.server";

export const loader = (args: LoaderFunctionArgs) => loadEmbeddedAppShell(args);

export default function AppShell() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisProvider i18n={jaTranslations}>
        <ui-nav-menu>
          <Link to="/app">ホーム</Link>
          <Link to="/app/preview">プレビュー</Link>
          <Link to="/app/pricing">料金</Link>
          <Link to="/app/welcome">利用開始</Link>
        </ui-nav-menu>
        <Outlet />
      </PolarisProvider>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
