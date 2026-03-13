import crypto from "node:crypto";

function isUniqueConstraintError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function addMilliseconds(value, milliseconds) {
  return new Date(value.getTime() + milliseconds);
}

function leaseableStates(now) {
  return [
    { state: "queued" },
    { state: "retryable" },
    { state: "leased", leaseExpiresAt: { lte: now } },
  ];
}

function currentAttemptNumber(job) {
  return (job?.attempts ?? 0) + 1;
}

async function ensureJobLeaseRow(tx, shopDomain) {
  try {
    await tx.jobLease.create({
      data: {
        shopDomain,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }
}

async function releaseJobLease(tx, { jobId, leaseToken, now, workerId }) {
  const job = await tx.job.findUnique({ where: { id: jobId } });

  if (!job) {
    return false;
  }

  const releasedLease = await tx.jobLease.updateMany({
    data: {
      jobId: null,
      leaseExpiresAt: now,
      leaseToken: null,
      workerId: null,
    },
    where: {
      jobId,
      leaseToken,
      shopDomain: job.shopDomain,
      workerId,
    },
  });

  return releasedLease.count === 1;
}

export function createPrismaJobQueue(prisma) {
  return {
    async enqueue({
      availableAt = new Date(),
      dedupeKey = null,
      kind,
      maxAttempts = 5,
      payload,
      shopDomain,
    }) {
      try {
        return await prisma.job.create({
          data: {
            availableAt,
            dedupeKey,
            kind,
            maxAttempts,
            payload,
            shopDomain,
            state: "queued",
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return null;
        }

        throw error;
      }
    },

    async leaseNext({
      kinds,
      leaseMs = 5 * 60 * 1000,
      now = new Date(),
      workerId,
    }) {
      const candidates = await prisma.job.findMany({
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
        where: {
          availableAt: { lte: now },
          kind: Array.isArray(kinds) && kinds.length > 0 ? { in: kinds } : undefined,
          OR: leaseableStates(now),
        },
      });

      for (const candidate of candidates) {
        const leasedJob = await prisma.$transaction(async (tx) => {
          await ensureJobLeaseRow(tx, candidate.shopDomain);

          const leaseToken = crypto.randomUUID();
          const leaseExpiresAt = addMilliseconds(now, leaseMs);
          const lockedShop = await tx.jobLease.updateMany({
            data: {
              jobId: candidate.id,
              leaseExpiresAt,
              leaseToken,
              workerId,
            },
            where: {
              shopDomain: candidate.shopDomain,
              OR: [
                { leaseToken: null },
                { leaseExpiresAt: { lte: now } },
              ],
            },
          });

          if (lockedShop.count === 0) {
            return null;
          }

          const attemptNumber = currentAttemptNumber(candidate);
          const claimed = await tx.job.updateMany({
            data: {
              attempts: attemptNumber,
              lastError: null,
              leaseExpiresAt,
              leaseToken,
              leasedAt: now,
              leasedBy: workerId,
              state: "leased",
            },
            where: {
              attempts: candidate.attempts,
              id: candidate.id,
              OR: leaseableStates(now),
            },
          });

          if (claimed.count === 0) {
            await tx.jobLease.updateMany({
              data: {
                jobId: null,
                leaseExpiresAt: now,
                leaseToken: null,
                workerId: null,
              },
              where: {
                leaseToken,
                shopDomain: candidate.shopDomain,
              },
            });
            return null;
          }

          await tx.jobAttempt.create({
            data: {
              attemptNumber,
              jobId: candidate.id,
              leaseExpiresAt,
              leaseToken,
              startedAt: now,
              workerId,
            },
          });

          return tx.job.findUnique({ where: { id: candidate.id } });
        });

        if (leasedJob) {
          return leasedJob;
        }
      }

      return null;
    },

    async heartbeat({
      jobId,
      leaseMs = 5 * 60 * 1000,
      now = new Date(),
      workerId,
    }) {
      const job = await prisma.job.findUnique({ where: { id: jobId } });

      if (!job || job.state !== "leased" || job.leasedBy !== workerId || !job.leaseToken) {
        return false;
      }

      const leaseExpiresAt = addMilliseconds(now, leaseMs);
      return prisma.$transaction(async (tx) => {
        const updatedLease = await tx.jobLease.updateMany({
          data: {
            leaseExpiresAt,
          },
          where: {
            jobId,
            leaseExpiresAt: { gt: now },
            leaseToken: job.leaseToken,
            shopDomain: job.shopDomain,
            workerId,
          },
        });

        if (updatedLease.count === 0) {
          return false;
        }

        const updatedJob = await tx.job.updateMany({
          data: {
            leaseExpiresAt,
          },
          where: {
            id: jobId,
            leaseExpiresAt: { gt: now },
            leaseToken: job.leaseToken,
            leasedBy: workerId,
            state: "leased",
          },
        });

        if (updatedJob.count === 0) {
          await tx.jobLease.updateMany({
            data: {
              leaseExpiresAt: now,
            },
            where: {
              jobId,
              leaseToken: job.leaseToken,
              shopDomain: job.shopDomain,
              workerId,
            },
          });
          return false;
        }

        await tx.jobAttempt.updateMany({
          data: {
            leaseExpiresAt,
          },
          where: {
            attemptNumber: job.attempts,
            jobId,
            leaseToken: job.leaseToken,
            workerId,
          },
        });

        return true;
      });
    },

    async complete({
      jobId,
      now = new Date(),
      workerId,
    }) {
      const job = await prisma.job.findUnique({ where: { id: jobId } });

      if (!job || job.state !== "leased" || job.leasedBy !== workerId || !job.leaseToken) {
        return false;
      }

      const attemptNumber = job.attempts;
      const leaseExpiresAt = job.leaseExpiresAt;
      const leaseToken = job.leaseToken;
      const shopDomain = job.shopDomain;

      const completed = await prisma.$transaction(async (tx) => {
        const liveLease = await tx.jobLease.updateMany({
          data: {
            leaseExpiresAt,
          },
          where: {
            jobId,
            leaseExpiresAt: { gt: now },
            leaseToken,
            shopDomain,
            workerId,
          },
        });

        if (liveLease.count === 0) {
          return false;
        }

        const updated = await tx.job.updateMany({
          data: {
            completedAt: now,
            leaseExpiresAt: null,
            leaseToken: null,
            leasedAt: null,
            leasedBy: null,
            state: "completed",
          },
          where: {
            id: jobId,
            leaseExpiresAt: { gt: now },
            leaseToken,
            leasedBy: workerId,
            state: "leased",
          },
        });

        if (updated.count === 0) {
          return false;
        }

        await tx.jobAttempt.update({
          data: {
            finishedAt: now,
            outcome: "completed",
          },
          where: {
            jobId_attemptNumber: {
              attemptNumber,
              jobId,
            },
          },
        });

        await releaseJobLease(tx, {
          jobId,
          leaseToken,
          now,
          workerId,
        });

        return true;
      });

      return completed;
    },

    async release({
      jobId,
      now = new Date(),
      workerId,
    }) {
      const job = await prisma.job.findUnique({ where: { id: jobId } });

      if (!job || job.state !== "leased" || job.leasedBy !== workerId || !job.leaseToken) {
        return false;
      }

      const attemptNumber = job.attempts;
      const leaseToken = job.leaseToken;
      const shopDomain = job.shopDomain;

      return prisma.$transaction(async (tx) => {
        const liveLease = await tx.jobLease.findFirst({
          where: {
            jobId,
            leaseExpiresAt: { gt: now },
            leaseToken,
            shopDomain,
            workerId,
          },
        });

        if (!liveLease) {
          return false;
        }

        const updated = await tx.job.updateMany({
          data: {
            attempts: Math.max(0, attemptNumber - 1),
            lastError: null,
            leaseExpiresAt: null,
            leaseToken: null,
            leasedAt: null,
            leasedBy: null,
            state: "queued",
          },
          where: {
            id: jobId,
            leaseExpiresAt: { gt: now },
            leaseToken,
            leasedBy: workerId,
            state: "leased",
          },
        });

        if (updated.count === 0) {
          return false;
        }

        await tx.jobAttempt.delete({
          where: {
            jobId_attemptNumber: {
              attemptNumber,
              jobId,
            },
          },
        });

        await tx.jobLease.updateMany({
          data: {
            jobId: null,
            leaseExpiresAt: now,
            leaseToken: null,
            workerId: null,
          },
          where: {
            jobId,
            leaseToken,
            shopDomain,
            workerId,
          },
        });

        return true;
      });
    },

    async fail({
      delayMs = 0,
      errorMessage,
      jobId,
      now = new Date(),
      workerId,
    }) {
      const job = await prisma.job.findUnique({ where: { id: jobId } });

      if (!job || job.state !== "leased" || job.leasedBy !== workerId || !job.leaseToken) {
        return null;
      }

      const shouldDeadLetter = job.attempts >= job.maxAttempts;
      const nextState = shouldDeadLetter ? "dead_letter" : "retryable";
      const availableAt = shouldDeadLetter ? job.availableAt : addMilliseconds(now, delayMs);
      const attemptNumber = job.attempts;
      const leaseExpiresAt = job.leaseExpiresAt;
      const leaseToken = job.leaseToken;
      const shopDomain = job.shopDomain;

      return prisma.$transaction(async (tx) => {
        const liveLease = await tx.jobLease.updateMany({
          data: {
            leaseExpiresAt,
          },
          where: {
            jobId,
            leaseExpiresAt: { gt: now },
            leaseToken,
            shopDomain,
            workerId,
          },
        });

        if (liveLease.count === 0) {
          return null;
        }

        const updated = await tx.job.updateMany({
          data: {
            availableAt,
            deadLetteredAt: shouldDeadLetter ? now : null,
            lastError: errorMessage,
            leaseExpiresAt: null,
            leaseToken: null,
            leasedAt: null,
            leasedBy: null,
            state: nextState,
          },
          where: {
            id: jobId,
            leaseExpiresAt: { gt: now },
            leaseToken,
            leasedBy: workerId,
            state: "leased",
          },
        });

        if (updated.count === 0) {
          return null;
        }

        await tx.jobAttempt.update({
          data: {
            errorMessage,
            finishedAt: now,
            outcome: shouldDeadLetter ? "dead_letter" : "retryable",
          },
          where: {
            jobId_attemptNumber: {
              attemptNumber,
              jobId,
            },
          },
        });

        await releaseJobLease(tx, {
          jobId,
          leaseToken,
          now,
          workerId,
        });

        return tx.job.findUnique({ where: { id: jobId } });
      });
    },
  };
}
