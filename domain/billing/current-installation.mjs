import {
  ENTITLEMENT_STATES,
  isTerminalSubscriptionStatus,
  mapSubscriptionStatusToEntitlement,
} from "./entitlement-state.mjs";

function normalizeSubscriptionValue(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeBooleanValue(value) {
  return value === true;
}

function normalizeSubscriptionRecord(subscription) {
  return {
    createdAt: normalizeSubscriptionValue(subscription?.createdAt),
    currentPeriodEnd: normalizeSubscriptionValue(subscription?.currentPeriodEnd),
    id: normalizeSubscriptionValue(subscription?.id),
    name: normalizeSubscriptionValue(subscription?.name),
    status: normalizeSubscriptionValue(subscription?.status),
    test: normalizeBooleanValue(subscription?.test),
  };
}

function compareCreatedAtDesc(left, right) {
  const leftTimestamp = left.createdAt ? Date.parse(left.createdAt) : Number.NEGATIVE_INFINITY;
  const rightTimestamp = right.createdAt ? Date.parse(right.createdAt) : Number.NEGATIVE_INFINITY;

  return rightTimestamp - leftTimestamp;
}

function pickFallbackSubscription(currentAppInstallation) {
  const allSubscriptions = Array.isArray(currentAppInstallation?.allSubscriptions?.nodes)
    ? currentAppInstallation.allSubscriptions.nodes
        .filter(Boolean)
        .map(normalizeSubscriptionRecord)
        .filter((subscription) => subscription.status !== null)
        .sort(compareCreatedAtDesc)
    : [];

  return allSubscriptions[0] ?? null;
}

export function deriveCurrentInstallationEntitlement(
  currentAppInstallation,
  { logMultipleActiveSubscriptions, logFallbackSubscriptionSelection } = {},
) {
  const activeSubscriptions = Array.isArray(currentAppInstallation?.activeSubscriptions)
    ? currentAppInstallation.activeSubscriptions.filter(Boolean).map(normalizeSubscriptionRecord)
    : [];

  if (activeSubscriptions.length > 1) {
    logMultipleActiveSubscriptions?.({
      activeSubscriptionCount: activeSubscriptions.length,
      statuses: activeSubscriptions.map((subscription) => subscription?.status ?? null),
      subscriptionIds: activeSubscriptions.map((subscription) => subscription?.id ?? null),
    });
  }

  const currentSubscription =
    activeSubscriptions[0] ??
    (() => {
      const fallbackSubscription = pickFallbackSubscription(currentAppInstallation);

      if (fallbackSubscription) {
        logFallbackSubscriptionSelection?.({
          fallbackStatus: fallbackSubscription.status,
          isTerminal: fallbackSubscription.status
            ? isTerminalSubscriptionStatus(fallbackSubscription.status)
            : null,
          subscriptionId: fallbackSubscription.id,
        });
      }

      return fallbackSubscription;
    })();

  const sourceStatus = normalizeSubscriptionValue(currentSubscription?.status);

  if (!sourceStatus) {
    return {
      checkedAt: null,
      currentPeriodEnd: null,
      hasActiveSubscription: false,
      sourceStatus: null,
      state: ENTITLEMENT_STATES.NOT_ENTITLED,
      subscriptionId: null,
      subscriptionName: null,
      test: false,
    };
  }

  return {
    checkedAt: null,
    currentPeriodEnd: currentSubscription.currentPeriodEnd,
    hasActiveSubscription: activeSubscriptions.length > 0,
    sourceStatus,
    state: mapSubscriptionStatusToEntitlement(sourceStatus),
    subscriptionId: currentSubscription.id,
    subscriptionName: currentSubscription.name,
    test: currentSubscription.test,
  };
}
