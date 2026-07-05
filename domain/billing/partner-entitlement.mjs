import { ENTITLEMENT_STATES } from "./entitlement-state.mjs";

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const DEFAULT_PAID_PLAN_HANDLES = Object.freeze(["standard"]);

function normalizeStringValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function normalizePlanHandle(value) {
  const normalized = normalizeStringValue(value)?.toLowerCase() ?? null;

  return normalized && HANDLE_PATTERN.test(normalized) ? normalized : null;
}

export function parseBillingTestPlanHandles(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (typeof value !== "string") {
    throw new Error("BILLING_TEST_PLAN_HANDLES must be a comma-separated string.");
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const handle = normalizePlanHandle(entry);

      if (!handle) {
        throw new Error(`Invalid BILLING_TEST_PLAN_HANDLES entry: ${entry}`);
      }

      return handle;
    });
}

export function buildPaidPlanHandleAllowlist({
  publicPlanHandles = DEFAULT_PAID_PLAN_HANDLES,
  testPlanHandlesEnv = process.env.BILLING_TEST_PLAN_HANDLES,
} = {}) {
  const handles = new Set();

  for (const handle of publicPlanHandles) {
    const normalized = normalizePlanHandle(handle);

    if (!normalized) {
      throw new Error(`Invalid public paid plan handle: ${handle}`);
    }

    handles.add(normalized);
  }

  for (const handle of parseBillingTestPlanHandles(testPlanHandlesEnv)) {
    handles.add(handle);
  }

  return handles;
}

function extractSubscriptionItems(activeSubscription) {
  return Array.isArray(activeSubscription?.items) ? activeSubscription.items : [];
}

function normalizeSubscriptionItems(activeSubscription) {
  return extractSubscriptionItems(activeSubscription)
    .map((item) => ({
      handle: normalizePlanHandle(item?.handle),
      price: item?.price ?? null,
    }))
    .filter((item) => item.handle);
}

function findAllowlistedItem(items, paidPlanHandles) {
  return items.find((item) => paidPlanHandles.has(item.handle)) ?? null;
}

export function derivePartnerApiEntitlement(
  activeSubscription,
  {
    paidPlanHandles = buildPaidPlanHandleAllowlist(),
  } = {},
) {
  const items = normalizeSubscriptionItems(activeSubscription);
  const allowlistedItem = findAllowlistedItem(items, paidPlanHandles);

  return {
    activeItemHandles: items.map((item) => item.handle),
    checkedAt: null,
    currentBillingCycle: activeSubscription?.currentBillingCycle ?? null,
    hasActiveSubscription: activeSubscription !== null && activeSubscription !== undefined,
    pendingUpdate: activeSubscription?.pendingUpdate ?? null,
    planHandle: allowlistedItem?.handle ?? null,
    price: allowlistedItem?.price ?? null,
    state: allowlistedItem ? ENTITLEMENT_STATES.ACTIVE_PAID : ENTITLEMENT_STATES.NOT_ENTITLED,
    legacySubscriptionId: normalizeStringValue(activeSubscription?.legacySubscriptionId),
    trialEndsAt: normalizeStringValue(activeSubscription?.trialEndsAt),
  };
}
