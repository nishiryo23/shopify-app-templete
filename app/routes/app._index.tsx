import { useFetcher, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  List,
  Page,
  SkeletonBodyText,
  Text,
} from "@shopify/polaris";

import { loadAppHome, type AppHomeLoaderData } from "~/app/services/app-shell.server";
import type { BillingEntitlement } from "~/app/services/billing.server";
import {
  getEntitlementStateLabel,
  getEntitlementStateTone,
  HOME_COPY,
} from "~/app/utils/admin-copy";

export const loader = (args: LoaderFunctionArgs) => loadAppHome(args);

export default function AppIndexRoute() {
  const { entitlement: initialEntitlement } = useLoaderData() as AppHomeLoaderData;
  const refreshFetcher = useFetcher<BillingEntitlement>();
  const entitlement = refreshFetcher.data ?? initialEntitlement;
  const isRefreshing = refreshFetcher.state !== "idle";

  return (
    <div data-testid="app-shell">
      <Page title={HOME_COPY.title}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{HOME_COPY.statusHeading}</Text>
                {isRefreshing ? (
                  <SkeletonBodyText lines={3} />
                ) : entitlement ? (
                  <div data-testid="home-entitlement-summary">
                    <BlockStack gap="300">
                      <InlineStack gap="200" align="start" blockAlign="center">
                        <Badge tone={getEntitlementStateTone(entitlement.state)}>
                          {getEntitlementStateLabel(entitlement.state, { includeCode: false })}
                        </Badge>
                        {entitlement.subscriptionName ? (
                          <Text as="p">
                            {HOME_COPY.subscriptionLabel}: {entitlement.subscriptionName}
                          </Text>
                        ) : null}
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        {HOME_COPY.checkedAtLabel}: {entitlement.checkedAt}
                      </Text>
                    </BlockStack>
                  </div>
                ) : (
                  <div data-testid="home-entitlement-error">
                    <Banner tone="critical" title={HOME_COPY.entitlementErrorTitle}>
                      <Text as="p">{HOME_COPY.entitlementErrorBody}</Text>
                    </Banner>
                  </div>
                )}
                <InlineStack gap="300">
                  <Button
                    loading={isRefreshing}
                    onClick={() => refreshFetcher.load("/app/billing/refresh")}
                  >
                    {HOME_COPY.refreshLabel}
                  </Button>
                  <Button variant="primary" url="/app/pricing">
                    {HOME_COPY.pricingCtaLabel}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{HOME_COPY.setupHeading}</Text>
                <List type="number">
                  <List.Item>{HOME_COPY.setupStepPlan}</List.Item>
                  <List.Item>{HOME_COPY.setupStepConfirm}</List.Item>
                  <List.Item>{HOME_COPY.setupStepBuild}</List.Item>
                </List>
                <Text as="p" tone="subdued">{HOME_COPY.setupFootnote}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
