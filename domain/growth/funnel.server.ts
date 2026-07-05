import prisma from "../../app/db.server";
import type { Prisma } from "@prisma/client";
import {
  resolveFunnelShopHash,
  sanitizeFunnelMetadata,
} from "./funnel-contract.mjs";
import { assertTelemetryPseudonymKeyFingerprint } from "./pseudonym-key.mjs";
import { addDays } from "../retention/policy.mjs";
import {
  buildOnboardingChecklist,
  isOnboardingStepId,
  ONBOARDING_STEP_IDS,
} from "./onboarding.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_FUNNEL_SUMMARY_DAYS = 7;
const DEFAULT_ONCE_DEDUPE_KEY = "once";

type PrismaLike = typeof prisma;
type PrismaTransactionLike = Prisma.TransactionClient;
type FunnelPrismaLike = PrismaLike | PrismaTransactionLike;
type ProcessEnvLike = Record<string, string | undefined>;

type FunnelWriteResult = {
  recorded: boolean;
  reason: "created" | "duplicate" | "missing_shop_hash";
};

type WeeklyFunnelSummary = {
  events: Array<{
    count: number;
    event: string;
  }>;
  since: string;
  until: string;
};

type RecordFunnelEventInput = {
  dedupeKey?: string | null;
  env?: ProcessEnvLike;
  event: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  prismaClient?: FunnelPrismaLike;
  shopDomain: string;
};

type OnboardingProgressRow = {
  completedAt: Date | null;
  stepId: string;
};

function calculateTenureDays({ installedAt, uninstalledAt }: {
  installedAt: Date;
  uninstalledAt: Date;
}) {
  return Math.max(0, Math.floor((uninstalledAt.getTime() - installedAt.getTime()) / DAY_MS));
}

function weeklyFunnelEventOrder() {
  return ONBOARDING_STEP_IDS.concat([
    "installed",
    "onboarding_step_completed",
    "uninstalled",
  ]).filter((event, index, events) => events.indexOf(event) === index);
}

function buildWeeklyFunnelSummary({
  countsByEvent,
  now,
}: {
  countsByEvent: Map<string, number>;
  now: Date;
}): WeeklyFunnelSummary {
  const since = addDays(now, -WEEKLY_FUNNEL_SUMMARY_DAYS);

  return {
    events: weeklyFunnelEventOrder().map((event) => ({
      count: countsByEvent.get(event) ?? 0,
      event,
    })),
    since: since.toISOString(),
    until: now.toISOString(),
  };
}

export async function recordFunnelEvent({
  dedupeKey = null,
  env = process.env,
  event,
  metadata = {},
  occurredAt = new Date(),
  prismaClient = prisma,
  shopDomain,
}: RecordFunnelEventInput): Promise<FunnelWriteResult> {
  const shopHash = resolveFunnelShopHash({ env, shopDomain });

  if (!shopHash) {
    return { recorded: false, reason: "missing_shop_hash" };
  }

  const sanitizedMetadata = sanitizeFunnelMetadata({ event, metadata });
  await assertTelemetryPseudonymKeyFingerprint({ env, prismaClient });

  await prismaClient.funnelEvent.create({
    data: {
      dedupeKey,
      event,
      metadata: sanitizedMetadata,
      occurredAt,
      shopHash,
    },
  });

  return { recorded: true, reason: "created" };
}

export async function recordFunnelEventOnce(input: RecordFunnelEventInput): Promise<FunnelWriteResult> {
  const dedupeKey = input.dedupeKey ?? DEFAULT_ONCE_DEDUPE_KEY;
  const env = input.env ?? process.env;
  const prismaClient = input.prismaClient ?? prisma;
  const shopHash = resolveFunnelShopHash({ env, shopDomain: input.shopDomain });

  if (!shopHash) {
    return { recorded: false, reason: "missing_shop_hash" };
  }

  const sanitizedMetadata = sanitizeFunnelMetadata({
    event: input.event,
    metadata: input.metadata ?? {},
  });
  await assertTelemetryPseudonymKeyFingerprint({ env, prismaClient });

  const created = await prismaClient.funnelEvent.createMany({
    data: [{
      dedupeKey,
      event: input.event,
      metadata: sanitizedMetadata,
      occurredAt: input.occurredAt ?? new Date(),
      shopHash,
    }],
    skipDuplicates: true,
  });

  return created.count === 1
    ? { recorded: true, reason: "created" }
    : { recorded: false, reason: "duplicate" };
}

export async function recordInstalledFunnelEvent({
  env = process.env,
  installedAt = new Date(),
  prismaClient = prisma,
  shopDomain,
}: {
  env?: ProcessEnvLike;
  installedAt?: Date;
  prismaClient?: PrismaLike;
  shopDomain: string;
}) {
  await prismaClient.growthState.createMany({
    data: [{ installedAt, shopDomain }],
    skipDuplicates: true,
  });
  await prismaClient.growthState.updateMany({
    data: { installedAt },
    where: {
      installedAt: null,
      shopDomain,
    },
  });

  return recordFunnelEventOnce({
    env,
    event: "installed",
    metadata: { source: "auth_bootstrap" },
    occurredAt: installedAt,
    prismaClient,
    shopDomain,
  });
}

async function readOnboardingProgress({
  prismaClient,
  shopDomain,
}: {
  prismaClient: FunnelPrismaLike;
  shopDomain: string;
}): Promise<OnboardingProgressRow[]> {
  return prismaClient.onboardingProgress.findMany({
    orderBy: [{ completedAt: "asc" }],
    select: {
      completedAt: true,
      stepId: true,
    },
    where: { shopDomain },
  });
}

export async function completeOnboardingStep({
  completedAt = new Date(),
  env = process.env,
  prismaClient = prisma,
  shopDomain,
  stepId,
}: {
  completedAt?: Date;
  env?: ProcessEnvLike;
  prismaClient?: PrismaLike;
  shopDomain: string;
  stepId: string;
}) {
  if (!isOnboardingStepId(stepId)) {
    throw new Error(`unknown-onboarding-step:${stepId}`);
  }

  const shopHash = resolveFunnelShopHash({ env, shopDomain });
  if (shopHash) {
    await assertTelemetryPseudonymKeyFingerprint({ env, prismaClient });
  }

  return prismaClient.$transaction(async (tx) => {
    const progressInsert = await tx.onboardingProgress.createMany({
      data: [{
        completedAt,
        shopDomain,
        stepId,
      }],
      skipDuplicates: true,
    });
    const progressCreated = progressInsert.count === 1;

    const progressRows = await readOnboardingProgress({ prismaClient: tx, shopDomain });
    const checklist = buildOnboardingChecklist({ progressRows });

    if (progressCreated) {
      await recordFunnelEvent({
        env,
        event: "onboarding_step_completed",
        metadata: {
          completedStepCount: checklist.completedStepCount,
          stepId,
          totalStepCount: checklist.totalStepCount,
        },
        occurredAt: completedAt,
        prismaClient: tx,
        shopDomain,
      });
    }

    if (stepId === "activated") {
      await tx.growthState.createMany({
        data: [{
          activatedAt: completedAt,
          shopDomain,
        }],
        skipDuplicates: true,
      });

      await tx.growthState.updateMany({
        data: { activatedAt: completedAt },
        where: {
          activatedAt: null,
          shopDomain,
        },
      });

      await recordFunnelEventOnce({
        env,
        event: "activated",
        metadata: {
          activationSource: "merchant_action",
          completedStepCount: checklist.completedStepCount,
          totalStepCount: checklist.totalStepCount,
        },
        occurredAt: completedAt,
        prismaClient: tx,
        shopDomain,
      });
    }

    return { completed: progressCreated, stepId };
  });
}

export async function recordPlanSelectionViewed({
  env = process.env,
  entitlementState,
  hasPlanSelectionUrl,
  occurredAt = new Date(),
  prismaClient = prisma,
  shopDomain,
}: {
  env?: ProcessEnvLike;
  entitlementState: string;
  hasPlanSelectionUrl: boolean;
  occurredAt?: Date;
  prismaClient?: PrismaLike;
  shopDomain: string;
}) {
  await recordFunnelEvent({
    env,
    event: "plan_selection_viewed",
    metadata: {
      entitlementState,
      hasPlanSelectionUrl,
    },
    occurredAt,
    prismaClient,
    shopDomain,
  });

  return completeOnboardingStep({
    completedAt: occurredAt,
    env,
    prismaClient,
    shopDomain,
    stepId: "plan_selection_viewed",
  });
}

export async function rememberEntitlementState({
  checkedAt = new Date(),
  env = process.env,
  entitlementState,
  prismaClient = prisma,
  shopDomain,
  subscriptionNamePresent,
  subscriptionStatus,
}: {
  checkedAt?: Date;
  env?: ProcessEnvLike;
  entitlementState: string;
  prismaClient?: PrismaLike;
  shopDomain: string;
  subscriptionNamePresent: boolean;
  subscriptionStatus: string | null;
}) {
  await prismaClient.growthState.upsert({
    create: {
      lastEntitlementCheckedAt: checkedAt,
      lastEntitlementState: entitlementState,
      shopDomain,
    },
    update: {
      lastEntitlementCheckedAt: checkedAt,
      lastEntitlementState: entitlementState,
    },
    where: { shopDomain },
  });

  if (entitlementState !== "ACTIVE_PAID") {
    return { recorded: false, reason: "not_active_paid" };
  }

  await recordFunnelEventOnce({
    env,
    event: "subscription_active",
    metadata: {
      entitlementState,
      subscriptionNamePresent,
      subscriptionStatus: subscriptionStatus ?? "ACTIVE",
    },
    occurredAt: checkedAt,
    prismaClient,
    shopDomain,
  });

  return completeOnboardingStep({
    completedAt: checkedAt,
    env,
    prismaClient,
    shopDomain,
    stepId: "subscription_active",
  });
}

export async function readOnboardingChecklist({
  entitlementState = "NOT_ENTITLED",
  prismaClient = prisma,
  shopDomain,
}: {
  entitlementState?: string;
  prismaClient?: PrismaLike;
  shopDomain: string;
}) {
  const progressRows = await readOnboardingProgress({ prismaClient, shopDomain });

  return buildOnboardingChecklist({ entitlementState, progressRows });
}

export async function readGrowthState({
  prismaClient = prisma,
  shopDomain,
}: {
  prismaClient?: PrismaLike;
  shopDomain: string;
}) {
  return prismaClient.growthState.findUnique({
    where: { shopDomain },
  });
}

export async function recordUninstalledFunnelEvent({
  env = process.env,
  occurredAt = new Date(),
  prismaClient = prisma,
  shopDomain,
}: {
  env?: ProcessEnvLike;
  occurredAt?: Date;
  prismaClient?: PrismaLike;
  shopDomain: string;
}) {
  const [growthState, shopState, progressRows] = await Promise.all([
    prismaClient.growthState.findUnique({ where: { shopDomain } }),
    prismaClient.shop.findUnique({
      select: { createdAt: true },
      where: { shopDomain },
    }),
    readOnboardingProgress({ prismaClient, shopDomain }),
  ]);
  const installedAt = growthState?.installedAt ?? shopState?.createdAt ?? occurredAt;
  const lastEntitlementState = growthState?.lastEntitlementState ?? "NOT_ENTITLED";
  const checklist = buildOnboardingChecklist({
    entitlementState: lastEntitlementState,
    progressRows,
  });
  const shopHash = resolveFunnelShopHash({ env, shopDomain });
  const sanitizedMetadata = sanitizeFunnelMetadata({
    event: "uninstalled",
    metadata: {
      installedAt: installedAt.toISOString(),
      lastEntitlementState,
      onboardingCompletedSteps: checklist.completedStepCount,
      onboardingCompletionRate: checklist.completionRate,
      onboardingTotalSteps: checklist.totalStepCount,
      tenureDays: calculateTenureDays({ installedAt, uninstalledAt: occurredAt }),
    },
  });

  if (shopHash) {
    await assertTelemetryPseudonymKeyFingerprint({ env, prismaClient });
    await prismaClient.funnelEvent.create({
      data: {
        event: "uninstalled",
        metadata: sanitizedMetadata,
        occurredAt,
        shopHash,
      },
    });
  }

  return {
    recorded: Boolean(shopHash),
    reason: shopHash ? "created" : "missing_shop_hash",
  };
}

export async function deleteRawGrowthStateForShop({
  prismaClient = prisma,
  shopDomain,
}: {
  prismaClient?: PrismaLike;
  shopDomain: string;
}) {
  return prismaClient.$transaction(async (tx) => {
    const deletedOnboardingProgress = await tx.onboardingProgress.deleteMany({
      where: { shopDomain },
    });
    const deletedReviewRequestState = await tx.reviewRequestState.deleteMany({
      where: { shopDomain },
    });
    const deletedGrowthState = await tx.growthState.deleteMany({
      where: { shopDomain },
    });

    return {
      deletedGrowthState: deletedGrowthState.count,
      deletedOnboardingProgress: deletedOnboardingProgress.count,
      deletedReviewRequestState: deletedReviewRequestState.count,
    };
  });
}

export async function queryWeeklyFunnelSummary({
  now = new Date(),
  prismaClient = prisma,
  shopHash,
}: {
  now?: Date;
  prismaClient?: PrismaLike;
  shopHash: string;
}) {
  if (!shopHash) {
    throw new Error("weekly-funnel-summary-shop-hash-required");
  }

  const since = addDays(now, -WEEKLY_FUNNEL_SUMMARY_DAYS);
  const rows = await prismaClient.funnelEvent.groupBy({
    _count: { _all: true },
    by: ["event"],
    where: {
      shopHash,
      occurredAt: {
        gte: since,
        lte: now,
      },
    },
  });
  const countsByEvent = new Map(rows.map((row) => [row.event, row._count._all]));

  return buildWeeklyFunnelSummary({ countsByEvent, now });
}

export function buildEmptyWeeklyFunnelSummary({ now = new Date() }: { now?: Date } = {}) {
  return buildWeeklyFunnelSummary({ countsByEvent: new Map(), now });
}
