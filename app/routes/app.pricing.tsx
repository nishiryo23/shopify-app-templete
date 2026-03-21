import { useFetcher, useLoaderData } from "react-router";
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
      <s-page heading="料金プラン">
        <s-section heading={stateCopy.heading}>
          <div data-testid={stateCopy.testId}>
            <s-paragraph>{stateCopy.description}</s-paragraph>
            <s-paragraph>
              現在の状態: {entitlementLabel}
              {entitlement.sourceStatus ? ` / Shopify 状態: ${entitlement.sourceStatus}` : ""}
            </s-paragraph>
            {entitlement.subscriptionName ? (
              <s-paragraph>契約名: {entitlement.subscriptionName}</s-paragraph>
            ) : null}
            {entitlement.currentPeriodEnd ? (
              <s-paragraph>更新期限: {entitlement.currentPeriodEnd}</s-paragraph>
            ) : null}
            <s-paragraph>最終確認: {entitlement.checkedAt}</s-paragraph>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
              <button
                disabled={refreshFetcher.state !== "idle"}
                onClick={() => refreshFetcher.load("/app/billing/refresh")}
                type="button"
              >
                {refreshFetcher.state === "idle" ? "状態を再確認" : "状態を再確認しています..."}
              </button>
              {stateCopy.actionHref && stateCopy.actionLabel ? (
                <a href={stateCopy.actionHref}>{stateCopy.actionLabel}</a>
              ) : null}
            </div>
          </div>
        </s-section>
        <s-section heading="課金判定の正本">
          <s-paragraph>
            この画面の状態は、Shopify の最新の契約状態をもとに表示しています。
          </s-paragraph>
          <s-paragraph>
            利用開始画面を開いただけでは契約は有効になりません。承認後にこの画面で状態を再確認してください。
          </s-paragraph>
        </s-section>
      </s-page>
    </div>
  );
}
