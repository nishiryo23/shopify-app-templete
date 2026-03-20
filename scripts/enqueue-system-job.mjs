import { PrismaClient } from "@prisma/client";

import { createPrismaJobQueue } from "../domain/jobs/prisma-job-queue.mjs";
import {
  buildSystemJobPayload,
  buildSystemRetentionSweepDedupeKey,
  buildSystemRetentionSweepScheduledAt,
  buildSystemStuckJobSweepDedupeKey,
  parseSystemRetentionSweepWindowDateFromDedupeKey,
  resolveSystemJobMaxAttempts,
  SYSTEM_JOB_SHOP_DOMAIN,
  SYSTEM_RETENTION_SWEEP_KIND,
  SYSTEM_STUCK_JOB_SWEEP_KIND,
} from "../domain/system-jobs/profile.mjs";

function resolveSystemJob(argv) {
  const kind = argv[2];

  if (kind === "retention-sweep") {
    const now = new Date();
    const dedupeKey = buildSystemRetentionSweepDedupeKey(now);
    const windowDate = parseSystemRetentionSweepWindowDateFromDedupeKey(dedupeKey);
    return {
      dedupeKey,
      kind: SYSTEM_RETENTION_SWEEP_KIND,
      maxAttempts: resolveSystemJobMaxAttempts(SYSTEM_RETENTION_SWEEP_KIND),
      payload: buildSystemJobPayload({
        dedupeKey,
        requestedAt: now,
        scheduledAt: windowDate ? buildSystemRetentionSweepScheduledAt(windowDate) : undefined,
        timeZone: "Asia/Tokyo",
        windowDate,
      }),
    };
  }

  if (kind === "stuck-job-sweep") {
    const now = new Date();
    const dedupeKey = buildSystemStuckJobSweepDedupeKey(now);
    return {
      dedupeKey,
      kind: SYSTEM_STUCK_JOB_SWEEP_KIND,
      maxAttempts: resolveSystemJobMaxAttempts(SYSTEM_STUCK_JOB_SWEEP_KIND),
      payload: buildSystemJobPayload({
        dedupeKey,
        requestedAt: now,
        windowStart: dedupeKey.slice("system:stuck-job-sweep:".length),
      }),
    };
  }

  throw new Error("Usage: node scripts/enqueue-system-job.mjs <retention-sweep|stuck-job-sweep>");
}

const prisma = new PrismaClient();

async function main() {
  const jobConfig = resolveSystemJob(process.argv);
  const queue = createPrismaJobQueue(prisma);
  const job = await queue.enqueue({
    dedupeKey: jobConfig.dedupeKey,
    kind: jobConfig.kind,
    maxAttempts: jobConfig.maxAttempts,
    payload: jobConfig.payload,
    shopDomain: SYSTEM_JOB_SHOP_DOMAIN,
  });

  process.stdout.write(`${JSON.stringify({
    dedupeKey: jobConfig.dedupeKey,
    jobId: job?.id ?? null,
    kind: jobConfig.kind,
  })}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
