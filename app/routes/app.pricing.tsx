import { useFetcher, useLoaderData } from "react-router";
import { Page, Layout, Card, BlockStack, Text, Button, InlineStack, Badge } from "@shopify/polaris";
import type { LoaderFunctionArgs } from "react-router";

import {
  loadPricingGate,
  type BillingEntitlement,
  type BillingGateLoaderData,
} from "~/app/services/billing.server";
import { getEntitlementStateLabel } from "~/app/utils/admin-copy";

export const loader = (args: LoaderFunctionArgs) => loadPricingGate(args);

function renderPricingStateCopy(state: string) {
  if (state === "ACTIVE_PAID") {
    return {
      actionHref: "/app",
      actionLabel: "アプリを開く",
      description: "有効な契約が確認できました。ホーム画面へ進めます。",
      heading: "契約は有効です",
      testId: "pricing-gate-active",
    };
  }

  if (state === "PENDING_APPROVAL") {
    return {
      actionHref: null,
      actionLabel: null,
      description: "Shopify 管理画面での承認完了後に、状態を再読み込みしてください。",
      heading: "承認待ちです",
      testId: "pricing-gate-pending",
    };
  }

  if (state === "PAYMENT_HOLD") {
    return {
      actionHref: null,
      actionLabel: null,
      description: "支払い保留が検出されました。解消後に状態を再読み込みしてください。",
      heading: "支払い保留です",
      testId: "pricing-gate-hold",
    };
  }

  return {
    actionHref: null,
    actionLabel: null,
    description: "有効な契約が確認できません。課金状態を確認してください。",
    heading: "未契約です",
    testId: "pricing-gate-not-entitled",
  };
}

export default function PricingRoute() {
  const { entitlement: initialEntitlement } = useLoaderData() as BillingGateLoaderData;
  const refreshFetcher = useFetcher<BillingEntitlement>();
  const entitlement = refreshFetcher.data ?? initialEntitlement;
  const stateCopy = renderPricingStateCopy(entitlement.state);
  const entitlementLabel = getEntitlementStateLabel(entitlement.state);

  return (
    <div data-testid="pricing-shell">
      <Page title="料金プラン">
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
                    {entitlement.subscriptionName ? (
                      <Text as="p">契約名: {entitlement.subscriptionName}</Text>
                    ) : null}
                    {entitlement.currentPeriodEnd ? (
                      <Text as="p">更新期限: {entitlement.currentPeriodEnd}</Text>
                    ) : null}
                    <Text as="p" tone="subdued">最終確認: {entitlement.checkedAt}</Text>
                    <InlineStack gap="300">
                      <Button
                        disabled={refreshFetcher.state !== "idle"}
                        onClick={() => refreshFetcher.load("/app/billing/refresh")}
                      >
                        {refreshFetcher.state === "idle" ? "状態を再確認" : "状態を再確認しています..."}
                      </Button>
                      {stateCopy.actionHref && stateCopy.actionLabel ? (
                        <Button variant="primary" url={stateCopy.actionHref}>{stateCopy.actionLabel}</Button>
                      ) : null}
                    </InlineStack>
                  </BlockStack>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">課金判定の正本</Text>
                <BlockStack gap="300">
                  <Text as="p">
                    この画面の状態は、Shopify の最新の契約状態をもとに表示しています。
                  </Text>
                  <Text as="p">
                    利用開始画面を開いただけでは契約は有効になりません。承認後にこの画面で状態を再確認してください。
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
