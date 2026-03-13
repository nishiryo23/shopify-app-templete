-- CreateTable
CREATE TABLE "Shop" (
    "shopDomain" TEXT NOT NULL PRIMARY KEY,
    "offlineSessionId" TEXT,
    "encryptedOfflineSession" JSONB,
    "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastBootstrapAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_offlineSessionId_key" ON "Shop"("offlineSessionId");
