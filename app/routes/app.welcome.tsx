import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import {
  loadWelcomeGate,
  type BillingGateLoaderData,
} from "~/app/services/billing.server";

export const loader = (args: LoaderFunctionArgs) => loadWelcomeGate(args);

function renderWelcomeStateCopy(state: string) {
  if (state === "PENDING_APPROVAL") {
    return {
      actionHref: "/app/pricing",
      actionLabel: "Pricing を開く",
      description: "課金承認の反映待ちです。Pricing 画面で状態を再確認してください。",
      heading: "承認待ちです",
      testId: "welcome-gate-pending",
    };
  }

  if (state === "PAYMENT_HOLD") {
    return {
      actionHref: "/app/pricing",
      actionLabel: "Pricing を開く",
      description: "支払い保留が検出されました。Pricing 画面から状態を確認してください。",
      heading: "支払い保留です",
      testId: "welcome-gate-hold",
    };
  }

  return {
    actionHref: "/app/pricing",
    actionLabel: "Pricing を開く",
    description: "この画面は導線確認用です。課金状態の正本は Pricing 画面の query 結果です。",
    heading: "Pricing へ進んでください",
    testId: "welcome-gate-not-entitled",
  };
}

export default function WelcomeRoute() {
  const { entitlement } = useLoaderData() as BillingGateLoaderData;
  const stateCopy = renderWelcomeStateCopy(entitlement.state);

  return (
    <div data-testid="welcome-shell">
      <s-page heading="Welcome">
        <s-section heading={stateCopy.heading}>
          <div data-testid={stateCopy.testId}>
            <s-paragraph>{stateCopy.description}</s-paragraph>
            <s-paragraph>
              現在状態: {entitlement.state}
              {entitlement.sourceStatus ? ` (${entitlement.sourceStatus})` : ""}
            </s-paragraph>
            <s-paragraph>
              welcome 遷移や query parameter だけでは entitlement は付与されません。
            </s-paragraph>
            <a href={stateCopy.actionHref}>{stateCopy.actionLabel}</a>
          </div>
        </s-section>
      </s-page>
    </div>
  );
}
