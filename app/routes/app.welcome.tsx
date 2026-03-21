import { useLoaderData } from "react-router";
import { Page, Layout, Card, BlockStack, Text, Button, InlineStack, Badge } from "@shopify/polaris";
import type { LoaderFunctionArgs } from "react-router";

import {
  loadWelcomeGate,
  type BillingGateLoaderData,
} from "~/app/services/billing.server";
import { getEntitlementStateLabel } from "~/app/utils/admin-copy";

export const loader = (args: LoaderFunctionArgs) => loadWelcomeGate(args);

function renderWelcomeStateCopy(state: string) {
  if (state === "PENDING_APPROVAL") {
    return {
      actionHref: "/app/pricing",
      actionLabel: "料金画面を開く",
      description: "課金承認の反映待ちです。料金画面で状態を再確認してください。",
      heading: "承認待ちです",
      testId: "welcome-gate-pending",
    };
  }

  if (state === "PAYMENT_HOLD") {
    return {
      actionHref: "/app/pricing",
      actionLabel: "料金画面を開く",
      description: "支払い保留が検出されました。料金画面から状態を確認してください。",
      heading: "支払い保留です",
      testId: "welcome-gate-hold",
    };
  }

  return {
    actionHref: "/app/pricing",
    actionLabel: "料金画面を開く",
    description: "この画面は利用開始の案内です。契約状態は料金画面で確認してください。",
    heading: "料金画面へ進んでください",
    testId: "welcome-gate-not-entitled",
  };
}

export default function WelcomeRoute() {
  const { entitlement } = useLoaderData() as BillingGateLoaderData;
  const stateCopy = renderWelcomeStateCopy(entitlement.state);
  const entitlementLabel = getEntitlementStateLabel(entitlement.state);

  return (
    <div data-testid="welcome-shell">
      <Page title="利用開始">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{stateCopy.heading}</Text>
                <div data-testid={stateCopy.testId}>
                  <BlockStack gap="300">
                    <Text as="p">{stateCopy.description}</Text>
                    <InlineStack gap="200" align="start">
                      <Text as="p">現在の状態: {entitlementLabel}</Text>
                      {entitlement.sourceStatus ? (
                        <Badge tone="info">{`Shopify 状態: ${entitlement.sourceStatus}`}</Badge>
                      ) : null}
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      この画面を開いただけでは契約は有効になりません。
                    </Text>
                    {stateCopy.actionHref && stateCopy.actionLabel ? (
                      <InlineStack>
                        <Button variant="primary" url={stateCopy.actionHref}>{stateCopy.actionLabel}</Button>
                      </InlineStack>
                    ) : null}
                  </BlockStack>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
