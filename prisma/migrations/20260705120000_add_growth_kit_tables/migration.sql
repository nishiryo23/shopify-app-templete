-- CreateTable
CREATE TABLE "GrowthState" (
    "shopDomain" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "lastEntitlementState" TEXT,
    "lastEntitlementCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthState_pkey" PRIMARY KEY ("shopDomain")
);

-- CreateTable
CREATE TABLE "OnboardingProgress" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRequestState" (
    "shopDomain" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "dismissedPermanently" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRequestState_pkey" PRIMARY KEY ("shopDomain")
);

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "shopHash" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryPseudonymKeyFingerprint" (
    "id" TEXT NOT NULL,
    "fingerprintSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelemetryPseudonymKeyFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingProgress_shopDomain_stepId_key" ON "OnboardingProgress"("shopDomain", "stepId");

-- CreateIndex
CREATE INDEX "OnboardingProgress_shopDomain_completedAt_idx" ON "OnboardingProgress"("shopDomain", "completedAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_event_occurredAt_idx" ON "FunnelEvent"("event", "occurredAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_occurredAt_idx" ON "FunnelEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_shopHash_occurredAt_idx" ON "FunnelEvent"("shopHash", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelEvent_shopHash_event_dedupeKey_key" ON "FunnelEvent"("shopHash", "event", "dedupeKey");
