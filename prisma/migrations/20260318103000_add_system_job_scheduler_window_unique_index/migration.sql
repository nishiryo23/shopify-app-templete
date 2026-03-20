CREATE UNIQUE INDEX "Job_system_scheduler_window_key"
ON "Job"("shopDomain", "kind", "dedupeKey")
WHERE "shopDomain" = '__system__'
  AND "dedupeKey" IS NOT NULL
  AND "state" <> 'dead_letter';
