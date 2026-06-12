import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import {
  AppProvider as PolarisProvider,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import jaTranslations from "@shopify/polaris/locales/ja.json";
import "@shopify/polaris/build/esm/styles.css";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

import { runAuthLoginAction, runAuthLoginLoader } from "~/app/services/auth.server";
import { LOGIN_COPY } from "~/app/utils/admin-copy";

export const loader = async (args: LoaderFunctionArgs) =>
  runAuthLoginLoader(args);

export const action = async (args: ActionFunctionArgs) =>
  runAuthLoginAction(args);

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

const loginErrorMessage: Record<LoginErrorType, string> = {
  [LoginErrorType.MissingShop]: LOGIN_COPY.missingShopError,
  [LoginErrorType.InvalidShop]: LOGIN_COPY.invalidShopError,
};

export default function AuthLogin() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const errors = actionData ?? loaderData;
  const shopError = errors?.shop ? loginErrorMessage[errors.shop] : undefined;

  return (
    <PolarisProvider i18n={jaTranslations}>
      <div data-testid="login-shell">
        <Page title={LOGIN_COPY.title}>
          <Card>
            <Form method="post">
              <FormLayout>
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">{LOGIN_COPY.description}</Text>
                </BlockStack>
                <TextField
                  autoComplete="on"
                  error={shopError}
                  label={LOGIN_COPY.shopFieldLabel}
                  name="shop"
                  onChange={setShop}
                  placeholder={LOGIN_COPY.shopFieldPlaceholder}
                  value={shop}
                />
                <Button submit variant="primary">{LOGIN_COPY.submitLabel}</Button>
              </FormLayout>
            </Form>
          </Card>
        </Page>
      </div>
    </PolarisProvider>
  );
}
