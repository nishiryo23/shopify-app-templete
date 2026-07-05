import { derivePartnerApiEntitlement } from "./partner-entitlement.mjs";
import { PartnerApiRateLimitError } from "./partner-api-client.mjs";

export const BILLING_ENTITLEMENT_SNAPSHOT_TTL_MS = 10 * 60 * 1000;

function dateFromValue(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid billing entitlement timestamp: ${value}`);
  }

  return date;
}

function optionalDateFromValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return dateFromValue(value);
}

function isoStringFromDateValue(value) {
  return value ? dateFromValue(value).toISOString() : null;
}

function nullableJsonValue(value) {
  return value === undefined ? null : value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isPartnerApiRateLimitError(error) {
  return error instanceof PartnerApiRateLimitError;
}

export function isBillingEntitlementSnapshotFresh({
  checkedAt,
  now = new Date(),
  ttlMs = BILLING_ENTITLEMENT_SNAPSHOT_TTL_MS,
}) {
  return dateFromValue(now).getTime() - dateFromValue(checkedAt).getTime() < ttlMs;
}

export function snapshotToBillingEntitlement(snapshot) {
  return {
    activeItemHandles: Array.isArray(snapshot.activeItemHandles) ? snapshot.activeItemHandles : [],
    checkedAt: isoStringFromDateValue(snapshot.checkedAt),
    currentBillingCycle: snapshot.currentBillingCycle ?? null,
    hasActiveSubscription: snapshot.hasActiveSubscription === true,
    legacySubscriptionId: snapshot.legacySubscriptionId ?? null,
    pendingUpdate: snapshot.pendingUpdate ?? null,
    planHandle: snapshot.planHandle ?? null,
    price: snapshot.price ?? null,
    state: snapshot.entitlementState,
    trialEndsAt: isoStringFromDateValue(snapshot.trialEndsAt),
  };
}

export async function refreshBillingEntitlementSnapshot({
  now = new Date(),
  paidPlanHandles,
  partnerApiClient,
  partnerAppId,
  partnerShopId,
  prismaClient,
  staleSnapshotCheckedAt = null,
  shopDomain,
}) {
  const checkedAt = dateFromValue(now);
  const activeSubscription = await partnerApiClient.queryActiveSubscription({
    appId: partnerAppId,
    shopId: partnerShopId,
  });
  const entitlement = derivePartnerApiEntitlement(activeSubscription, { paidPlanHandles });
  const snapshotData = {
    activeItemHandles: entitlement.activeItemHandles,
    checkedAt,
    currentBillingCycle: nullableJsonValue(entitlement.currentBillingCycle),
    entitlementState: entitlement.state,
    hasActiveSubscription: entitlement.hasActiveSubscription,
    legacySubscriptionId: entitlement.legacySubscriptionId,
    pendingUpdate: nullableJsonValue(entitlement.pendingUpdate),
    partnerAppId,
    partnerShopId,
    planHandle: entitlement.planHandle,
    price: nullableJsonValue(entitlement.price),
    trialEndsAt: optionalDateFromValue(entitlement.trialEndsAt),
  };

  if (staleSnapshotCheckedAt) {
    const updated = await prismaClient.billingEntitlementSnapshot.updateMany({
      data: snapshotData,
      where: {
        checkedAt: { lte: dateFromValue(staleSnapshotCheckedAt) },
        shopDomain,
      },
    });

    if (updated.count === 0) {
      const latestSnapshot = await prismaClient.billingEntitlementSnapshot.findUnique({
        where: { shopDomain },
      });

      if (latestSnapshot) {
        return snapshotToBillingEntitlement(latestSnapshot);
      }
    }
  } else {
    await prismaClient.billingEntitlementSnapshot.upsert({
      create: {
        ...snapshotData,
        shopDomain,
      },
      update: snapshotData,
      where: { shopDomain },
    });
  }

  return {
    ...entitlement,
    checkedAt: checkedAt.toISOString(),
  };
}

export async function resolveBillingEntitlement({
  allowStaleFallback = true,
  forceRefresh = false,
  logger = console,
  now = new Date(),
  paidPlanHandles,
  partnerApiClient,
  partnerAppId,
  partnerShopId,
  prismaClient,
  shopDomain,
  ttlMs = BILLING_ENTITLEMENT_SNAPSHOT_TTL_MS,
}) {
  const snapshot = await prismaClient.billingEntitlementSnapshot.findUnique({
    where: { shopDomain },
  });

  if (
    !forceRefresh
    && snapshot
    && isBillingEntitlementSnapshotFresh({ checkedAt: snapshot.checkedAt, now, ttlMs })
  ) {
    return snapshotToBillingEntitlement(snapshot);
  }

  try {
    return await refreshBillingEntitlementSnapshot({
      now,
      paidPlanHandles,
      partnerApiClient,
      partnerAppId,
      partnerShopId,
      prismaClient,
      staleSnapshotCheckedAt: snapshot?.checkedAt ?? null,
      shopDomain,
    });
  } catch (error) {
    if (snapshot && allowStaleFallback) {
      logger.warn("Falling back to cached billing entitlement snapshot after Partner API refresh failed.", {
        checkedAt: isoStringFromDateValue(snapshot.checkedAt),
        error: errorMessage(error),
        rateLimited: isPartnerApiRateLimitError(error),
        shopDomain,
      });

      return snapshotToBillingEntitlement(snapshot);
    }

    throw error;
  }
}
