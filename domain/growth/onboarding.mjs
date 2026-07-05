export const ONBOARDING_STEP_IDS = Object.freeze([
  "plan_selection_viewed",
  "subscription_active",
  "activated",
]);

export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({
    actionHref: "/app/pricing",
    actionKind: "link",
    ctaLabel: "料金プランを確認",
    description: "料金画面を開き、導入前の契約状態を確認します。",
    id: "plan_selection_viewed",
    isComplete({ completedStepIds }) {
      return completedStepIds.has("plan_selection_viewed");
    },
    title: "料金プランを確認",
  }),
  Object.freeze({
    actionHref: "/app/pricing",
    actionKind: "link",
    ctaLabel: "契約状態を再確認",
    description: "Shopify の契約状態が有効になったことを確認します。",
    id: "subscription_active",
    isComplete({ completedStepIds, entitlementState }) {
      return completedStepIds.has("subscription_active") || entitlementState === "ACTIVE_PAID";
    },
    title: "契約状態を確認",
  }),
  Object.freeze({
    actionHref: null,
    actionKind: "complete",
    ctaLabel: "初回価値行動を完了にする",
    description: "派生アプリで定義する初回価値行動を完了した状態にします。",
    id: "activated",
    isComplete({ completedStepIds }) {
      return completedStepIds.has("activated");
    },
    title: "初回価値行動を完了",
  }),
]);

const ONBOARDING_STEP_ID_SET = new Set(ONBOARDING_STEP_IDS);

/**
 * @typedef {{
 *   completedAt: Date | null;
 *   stepId: string;
 * }} OnboardingProgressRow
 */

export function isOnboardingStepId(value) {
  return ONBOARDING_STEP_ID_SET.has(value);
}

export function isMerchantCompletableOnboardingStepId(value) {
  return ONBOARDING_STEPS.some((step) => step.id === value && step.actionKind === "complete");
}

/**
 * @param {OnboardingProgressRow[]} [progressRows]
 */
export function buildCompletedStepSet(progressRows = []) {
  return new Set(
    progressRows
      .filter((row) => row?.completedAt)
      .map((row) => row.stepId),
  );
}

export function calculateOnboardingCompletion({ completedStepCount, totalStepCount }) {
  if (totalStepCount <= 0) {
    return 0;
  }

  return completedStepCount / totalStepCount;
}

/**
 * @param {{
 *   entitlementState?: string;
 *   progressRows?: OnboardingProgressRow[];
 * }} [options]
 */
export function buildOnboardingChecklist({
  entitlementState = "NOT_ENTITLED",
  progressRows = [],
} = {}) {
  const completedStepIds = buildCompletedStepSet(progressRows);
  const completedAtByStep = new Map(
    progressRows
      .filter((row) => row?.completedAt)
      .map((row) => [row.stepId, row.completedAt]),
  );
  const steps = ONBOARDING_STEPS.map((definition) => {
    const completed = definition.isComplete({ completedStepIds, entitlementState });
    const completedAt = completedAtByStep.get(definition.id) ?? null;

    return {
      actionHref: definition.actionHref,
      actionKind: definition.actionKind,
      completed,
      completedAt,
      ctaLabel: definition.ctaLabel,
      description: definition.description,
      id: definition.id,
      title: definition.title,
    };
  });
  const completedStepCount = steps.filter((step) => step.completed).length;
  const totalStepCount = steps.length;

  return {
    completedStepCount,
    completionRate: calculateOnboardingCompletion({ completedStepCount, totalStepCount }),
    isComplete: totalStepCount > 0 && completedStepCount === totalStepCount,
    steps,
    totalStepCount,
  };
}
