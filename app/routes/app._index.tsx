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
  Page,
  SkeletonBodyText,
  Text,
} from "@shopify/polaris";

import { loadAppHome, type AppHomeLoaderData } from "~/app/services/app-shell.server";
import type { BillingEntitlement } from "~/app/services/billing.server";
import type {
  OnboardingActionData,
  ReviewRequestActionData,
} from "~/app/services/growth.server";
import {
  getEntitlementStateLabel,
  getEntitlementStateTone,
  GROWTH_COPY,
  HOME_COPY,
} from "~/app/utils/admin-copy";

export const loader = (args: LoaderFunctionArgs) => loadAppHome(args);

export default function AppIndexRoute() {
  const {
    entitlement: initialEntitlement,
    growth: initialGrowth,
  } = useLoaderData() as AppHomeLoaderData;
  const refreshFetcher = useFetcher<BillingEntitlement>();
  const onboardingFetcher = useFetcher<OnboardingActionData>();
  const reviewFetcher = useFetcher<ReviewRequestActionData>();
  const entitlement = refreshFetcher.data ?? initialEntitlement;
  const isRefreshing = refreshFetcher.state !== "idle";
  const onboarding = onboardingFetcher.data?.onboarding ?? initialGrowth?.onboarding ?? null;
  const reviewRequestDismissed = reviewFetcher.data?.status === "dismissed";
  const reviewRequest = reviewRequestDismissed ? null : initialGrowth?.reviewRequest;
  const isCompletingOnboarding = onboardingFetcher.state !== "idle";
  const isDismissingReviewRequest = reviewFetcher.state !== "idle";

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
                        {entitlement.planHandle ? (
                          <Text as="p">
                            {HOME_COPY.subscriptionLabel}: {entitlement.planHandle}
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
                <Text as="h2" variant="headingMd">{GROWTH_COPY.onboardingHeading}</Text>
                {onboardingFetcher.data?.status === "completed" ? (
                  <Banner tone="success" title={GROWTH_COPY.onboardingFeedbackCompleted} />
                ) : null}
                {onboardingFetcher.data?.status === "invalid-step" ? (
                  <Banner tone="critical" title={GROWTH_COPY.onboardingFeedbackInvalid} />
                ) : null}
                {reviewRequestDismissed ? (
                  <Banner tone="success" title={GROWTH_COPY.reviewDismissedTitle} />
                ) : null}
                {!onboarding ? (
                  <div data-testid="home-growth-error">
                    <Banner tone="critical" title={GROWTH_COPY.onboardingErrorTitle}>
                      <Text as="p">{GROWTH_COPY.onboardingErrorBody}</Text>
                    </Banner>
                  </div>
                ) : (
                  <BlockStack gap="400">
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <Text as="p">
                        {GROWTH_COPY.onboardingProgressLabel}: {onboarding.completedStepCount} / {onboarding.totalStepCount}
                      </Text>
                      <Badge tone={onboarding.isComplete ? "success" : "attention"}>
                        {onboarding.isComplete
                          ? GROWTH_COPY.onboardingCompleteLabel
                          : GROWTH_COPY.onboardingIncompleteLabel}
                      </Badge>
                    </InlineStack>
                    <BlockStack gap="300">
                      {onboarding.steps.map((step) => (
                        <InlineStack key={step.id} gap="300" align="space-between" blockAlign="start" wrap={false}>
                          <BlockStack gap="100">
                            <InlineStack gap="200" align="start" blockAlign="center">
                              <Badge tone={step.completed ? "success" : "attention"}>
                                {step.completed
                                  ? GROWTH_COPY.onboardingCompleteLabel
                                  : GROWTH_COPY.onboardingIncompleteLabel}
                              </Badge>
                              <Text as="p" fontWeight="semibold">{step.title}</Text>
                            </InlineStack>
                            <Text as="p" tone="subdued">{step.description}</Text>
                          </BlockStack>
                          {!step.completed && step.actionKind === "link" && step.actionHref ? (
                            <Button url={step.actionHref}>{step.ctaLabel}</Button>
                          ) : null}
                          {!step.completed && step.actionKind === "complete" ? (
                            <Button
                              loading={isCompletingOnboarding}
                              onClick={() => onboardingFetcher.submit(
                                { stepId: step.id },
                                { action: "/app/growth/onboarding", method: "post" },
                              )}
                            >
                              {step.ctaLabel}
                            </Button>
                          ) : null}
                        </InlineStack>
                      ))}
                    </BlockStack>
                    {reviewRequest?.shouldShow && reviewRequest.actionUrl ? (
                      <Banner tone="info" title={GROWTH_COPY.reviewHeading}>
                        <BlockStack gap="300">
                          <Text as="p">{GROWTH_COPY.reviewBody}</Text>
                          <InlineStack gap="300">
                            <Button target="_blank" url={reviewRequest.actionUrl}>
                              {GROWTH_COPY.reviewOpenLabel}
                            </Button>
                            <Button
                              disabled={isDismissingReviewRequest}
                              onClick={() => reviewFetcher.submit(
                                {},
                                { action: "/app/growth/review-request", method: "post" },
                              )}
                            >
                              {GROWTH_COPY.reviewDismissLabel}
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Banner>
                    ) : null}
                  </BlockStack>
                )}
                <Text as="p" tone="subdued">{HOME_COPY.setupFootnote}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
