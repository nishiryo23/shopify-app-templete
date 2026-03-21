import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

import { runAuthLoginAction, runAuthLoginLoader } from "~/app/services/auth.server";

export const loader = async (args: LoaderFunctionArgs) =>
  runAuthLoginLoader(args);

export const action = async (args: ActionFunctionArgs) =>
  runAuthLoginAction(args);

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

const loginErrorMessage: Record<LoginErrorType, string> = {
  [LoginErrorType.MissingShop]: "ショップドメインを入力してください。",
  [LoginErrorType.InvalidShop]: "有効なショップドメインを入力してください。",
};

export default function AuthLogin() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = actionData ?? loaderData;
  const shopError = errors?.shop ? loginErrorMessage[errors.shop] : null;

  return (
    <div style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.25rem" }}>ショップに接続</h1>
      <p style={{ color: "#444", maxWidth: "32rem" }}>
        開発ストアのドメインを入力するか、管理画面のアプリから開いてください。
      </p>
      <Form method="post" style={{ marginTop: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>
          ショップドメイン
          <input
            name="shop"
            type="text"
            placeholder="your-store.myshopify.com"
            style={{ display: "block", width: "100%", maxWidth: "24rem", marginTop: "0.35rem" }}
            autoComplete="on"
          />
        </label>
        {shopError ? (
          <p role="alert" style={{ color: "#b42318", marginBottom: "0.5rem" }}>
            {shopError}
          </p>
        ) : null}
        <button type="submit">続行</button>
      </Form>
    </div>
  );
}
