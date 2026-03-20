import { emitEvent, emitMetric, TELEMETRY_METRICS } from "../domain/telemetry/emf.mjs";
import { createPrismaJobQueue } from "../domain/jobs/prisma-job-queue.mjs";
import { resolveSweepTelemetry } from "./system-sweep-telemetry.mjs";

export async function runSystemStuckJobSweepJob({
  assertJobLeaseActive = () => {},
  emit = { emitEvent, emitMetric },
  job,
  jobQueue,
  leaseMs,
  now = new Date(),
  prisma,
  queueLeaseMs = leaseMs ?? 5 * 60 * 1000,
  telemetry,
} = {}) {
  const telemetryClient = resolveSweepTelemetry({ emit, telemetry });
  const queue = jobQueue ?? createPrismaJobQueue(prisma);
  const scanCutoff = new Date(now.getTime() - (queueLeaseMs * 2));
  assertJobLeaseActive();
  const staleJobs = await prisma.job.findMany({
    orderBy: [{ leaseExpiresAt: "asc" }],
    where: {
      leaseExpiresAt: { lte: scanCutoff },
      state: "leased",
    },
  });

  let recovered = 0;
  let skipped = 0;

  for (const staleJob of staleJobs) {
    assertJobLeaseActive();
    const result = await queue.recoverStaleLease({
      jobId: staleJob.id,
      now,
      scanCutoff,
    });

    if (result?.recovered) {
      if (result.nextState === "dead_letter") {
        assertJobLeaseActive();
        telemetryClient.emitCounterMetric({
          metricName: TELEMETRY_METRICS.DEAD_LETTERED_JOBS,
          value: 1,
        });
        assertJobLeaseActive();
        telemetryClient.emitEvent({
          event: "job.dead_lettered",
          jobId: staleJob.id,
          jobKind: staleJob.kind ?? null,
          shopDomain: staleJob.shopDomain ?? null,
        });
      }

      recovered += 1;
      continue;
    }

    skipped += 1;
  }

  assertJobLeaseActive();
  const unresolvedStaleJobs = typeof prisma.job.count === "function"
    ? await prisma.job.count({
      where: {
        leaseExpiresAt: { lte: scanCutoff },
        state: "leased",
      },
    })
    : skipped;
  assertJobLeaseActive();
  telemetryClient.emitGaugeMetric({
    metricName: TELEMETRY_METRICS.STALE_LEASED_JOBS,
    value: unresolvedStaleJobs,
  });
  if (recovered > 0) {
    assertJobLeaseActive();
    telemetryClient.emitCounterMetric({
      metricName: TELEMETRY_METRICS.RECOVERED_STALE_LEASED_JOBS,
      value: recovered,
    });
  }
  assertJobLeaseActive();
  telemetryClient.emitEvent({
    event: "system.stuck_job_sweep.completed",
    detectedStaleJobs: staleJobs.length,
    jobId: job?.id ?? null,
    recoveredStaleJobs: recovered,
    unresolvedStaleJobs,
    skippedStaleJobs: skipped,
  });

  return {
    detectedStaleJobs: staleJobs.length,
    recoveredStaleJobs: recovered,
    unresolvedStaleJobs,
    skippedStaleJobs: skipped,
  };
}
