ALTER TABLE "Shop" ADD COLUMN "shopGid" TEXT;

CREATE TABLE "BillingEntitlementSnapshot" (
    "shopDomain" TEXT NOT NULL,
    "partnerAppId" TEXT NOT NULL,
    "partnerShopId" TEXT NOT NULL,
    "activeItemHandles" JSONB,
    "planHandle" TEXT,
    "legacySubscriptionId" TEXT,
    "price" JSONB,
    "currentBillingCycle" JSONB,
    "trialEndsAt" TIMESTAMP(3),
    "pendingUpdate" JSONB,
    "hasActiveSubscription" BOOLEAN NOT NULL DEFAULT false,
    "entitlementState" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEntitlementSnapshot_pkey" PRIMARY KEY ("shopDomain")
);

CREATE INDEX "BillingEntitlementSnapshot_checkedAt_idx" ON "BillingEntitlementSnapshot"("checkedAt");
CREATE INDEX "BillingEntitlementSnapshot_entitlementState_idx" ON "BillingEntitlementSnapshot"("entitlementState");
