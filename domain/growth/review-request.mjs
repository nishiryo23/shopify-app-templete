import { addDays } from "../retention/policy.mjs";

export const REVIEW_PROMPT_MIN_INSTALL_AGE_DAYS = 7;
export const REVIEW_PROMPT_REASK_INTERVAL_DAYS = 180;

function isAfterOrEqual(left, right) {
  return left.getTime() >= right.getTime();
}

/**
 * @param {{
 *   activatedAt?: Date | null;
 *   askedAt?: Date | null;
 *   dismissedPermanently?: boolean;
 *   entitlementState?: string;
 *   installedAt?: Date | null;
 *   now?: Date;
 *   onboardingComplete?: boolean;
 *   reviewUrl?: string | null;
 * }} [options]
 * @returns {{ reason: string; shouldShow: boolean }}
 */
export function resolveReviewPrompt({
  activatedAt = null,
  askedAt = null,
  dismissedPermanently = false,
  entitlementState,
  installedAt,
  now = new Date(),
  onboardingComplete,
  reviewUrl,
} = {}) {
  if (!reviewUrl) {
    return { reason: "missing_review_url", shouldShow: false };
  }

  if (entitlementState !== "ACTIVE_PAID") {
    return { reason: "not_paid", shouldShow: false };
  }

  if (!onboardingComplete) {
    return { reason: "onboarding_incomplete", shouldShow: false };
  }

  if (!activatedAt) {
    return { reason: "not_activated", shouldShow: false };
  }

  if (!installedAt) {
    return { reason: "missing_install_date", shouldShow: false };
  }

  if (!isAfterOrEqual(now, addDays(installedAt, REVIEW_PROMPT_MIN_INSTALL_AGE_DAYS))) {
    return { reason: "too_early", shouldShow: false };
  }

  if (dismissedPermanently) {
    return { reason: "dismissed", shouldShow: false };
  }

  if (askedAt && !isAfterOrEqual(now, addDays(askedAt, REVIEW_PROMPT_REASK_INTERVAL_DAYS))) {
    return { reason: "cooldown", shouldShow: false };
  }

  return { reason: "eligible", shouldShow: true };
}
