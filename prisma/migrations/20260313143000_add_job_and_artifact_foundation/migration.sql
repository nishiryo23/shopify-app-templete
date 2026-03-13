-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('queued', 'retryable', 'leased', 'completed', 'dead_letter');

-- CreateEnum
CREATE TYPE "ArtifactVisibility" AS ENUM ('private');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "state" "JobState" NOT NULL DEFAULT 'queued',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leasedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "leasedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLease" (
    "shopDomain" TEXT NOT NULL,
    "jobId" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "workerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("shopDomain")
);

-- CreateTable
CREATE TABLE "JobAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "workerId" TEXT NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "errorMessage" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "visibility" "ArtifactVisibility" NOT NULL DEFAULT 'private',
    "retentionUntil" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_shopDomain_kind_dedupeKey_active_key"
ON "Job"("shopDomain", "kind", "dedupeKey")
WHERE "dedupeKey" IS NOT NULL AND "state" IN ('queued', 'retryable', 'leased');

-- CreateIndex
CREATE INDEX "Job_state_availableAt_idx" ON "Job"("state", "availableAt");

-- CreateIndex
CREATE INDEX "Job_shopDomain_state_availableAt_idx" ON "Job"("shopDomain", "state", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobAttempt_jobId_attemptNumber_key" ON "JobAttempt"("jobId", "attemptNumber");

-- CreateIndex
CREATE INDEX "JobAttempt_workerId_startedAt_idx" ON "JobAttempt"("workerId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_bucket_objectKey_key" ON "Artifact"("bucket", "objectKey");

-- CreateIndex
CREATE INDEX "Artifact_shopDomain_kind_createdAt_idx" ON "Artifact"("shopDomain", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
