const ENTITLEMENT_STATE_LABELS = {
  ACTIVE_PAID: "有効",
  NOT_ENTITLED: "未契約",
  PAYMENT_HOLD: "支払い保留",
  PENDING_APPROVAL: "承認待ち",
} as const;

const ENTITLEMENT_STATE_TONES = {
  ACTIVE_PAID: "success",
  NOT_ENTITLED: "critical",
  PAYMENT_HOLD: "warning",
  PENDING_APPROVAL: "attention",
} as const;

type IncludeCodeOptions = {
  includeCode?: boolean;
};

type EntitlementState = keyof typeof ENTITLEMENT_STATE_LABELS;

export type EntitlementStateTone =
  (typeof ENTITLEMENT_STATE_TONES)[keyof typeof ENTITLEMENT_STATE_TONES];

function formatCodeLabel(label: string, code: string, includeCode = true) {
  if (!includeCode || !code) {
    return label;
  }

  return `${label} (${code})`;
}

export function getEntitlementStateLabel(
  state: string,
  { includeCode = true }: IncludeCodeOptions = {},
) {
  return formatCodeLabel(
    ENTITLEMENT_STATE_LABELS[state as EntitlementState] ?? "未契約",
    state,
    includeCode,
  );
}

export function getEntitlementStateTone(state: string): EntitlementStateTone {
  return ENTITLEMENT_STATE_TONES[state as EntitlementState] ?? "critical";
}

const PLAN_SELECTION_CTA_LABELS = {
  ACTIVE_PAID: "プランを変更する",
  NOT_ENTITLED: "プランを選択する",
  PAYMENT_HOLD: "プランと支払い状況を確認する",
  PENDING_APPROVAL: "プラン選択画面を開き直す",
} as const;

export function getPlanSelectionCtaLabel(state: string) {
  return (
    PLAN_SELECTION_CTA_LABELS[state as EntitlementState] ??
    PLAN_SELECTION_CTA_LABELS.NOT_ENTITLED
  );
}

export const HOME_COPY = {
  checkedAtLabel: "最終確認",
  entitlementErrorBody: "時間をおいて再読み込みするか、「状態を再確認」を押してください。",
  entitlementErrorTitle: "契約状態を取得できませんでした",
  pricingCtaLabel: "料金プランを確認",
  refreshLabel: "状態を再確認",
  setupFootnote: "ドメイン機能は ticket と ADR を追加してから実装します（docs/template_scope.md 参照）。",
  setupHeading: "セットアップガイド",
  setupStepBuild: "ドメイン機能を ticket として追加し、この画面を起点に拡張する",
  setupStepConfirm: "このホームで契約状態が「有効」になることを確認する",
  setupStepPlan: "料金プランを確認し、プランを選択する",
  statusHeading: "ご利用状況",
  subscriptionLabel: "契約名",
  title: "ホーム",
} as const;

export const LOGIN_COPY = {
  description: "開発ストアのドメインを入力するか、Shopify 管理画面のアプリから開いてください。",
  invalidShopError: "有効なショップドメインを入力してください。",
  missingShopError: "ショップドメインを入力してください。",
  shopFieldLabel: "ショップドメイン",
  shopFieldPlaceholder: "your-store.myshopify.com",
  submitLabel: "続行",
  title: "ショップに接続",
} as const;
