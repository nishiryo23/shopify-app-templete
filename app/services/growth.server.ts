import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import prisma from "../db.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import type { BillingEntitlement } from "./billing.server";
import { queryPartnerApiBillingEntitlement } from "./billing.server";
import {
  buildEmptyWeeklyFunnelSummary,
  completeOnboardingStep,
  queryWeeklyFunnelSummary,
  readGrowthState,
  readOnboardingChecklist,
} from "~/domain/growth/funnel.server";
import { resolveFunnelShopHash } from "~/domain/growth/funnel-contract.mjs";
import {
  isMerchantCompletableOnboardingStepId,
  isOnboardingStepId,
} from "~/domain/growth/onboarding.mjs";
import {
  resolveReviewPrompt,
  REVIEW_PROMPT_REASK_INTERVAL_DAYS,
} from "~/domain/growth/review-request.mjs";
import { addDays } from "~/domain/retention/policy.mjs";

export type GrowthOnboardingStep = {
  actionHref: string | null;
  actionKind: string;
  completed: boolean;
  completedAt: string | null;
  ctaLabel: string;
  description: string;
  id: string;
  title: string;
};

export type GrowthOnboardingData = {
  completedStepCount: number;
  completionRate: number;
  isComplete: boolean;
  steps: GrowthOnboardingStep[];
  totalStepCount: number;
};

export type GrowthReviewRequestData = {
  actionUrl: string | null;
  reason: string;
  shouldShow: boolean;
};

export type GrowthHomeData = {
  onboarding: GrowthOnboardingData;
  reviewRequest: GrowthReviewRequestData;
};

export type OnboardingActionData = {
  onboarding?: GrowthOnboardingData;
  status: "completed" | "invalid-step";
};

export type ReviewRequestActionData = {
  status: "dismissed";
};

function serializeOnboardingChecklist(checklist: {
  completedStepCount: number;
  completionRate: number;
  isComplete: boolean;
  steps: Array<{
    actionHref: string | null;
    actionKind: string;
    completed: boolean;
    completedAt: Date | null;
    ctaLabel: string;
    description: string;
    id: string;
    title: string;
  }>;
  totalStepCount: number;
}): GrowthOnboardingData {
  return {
    completedStepCount: checklist.completedStepCount,
    completionRate: checklist.completionRate,
    isComplete: checklist.isComplete,
    steps: checklist.steps.map((step) => ({
      ...step,
      completedAt: step.completedAt ? step.completedAt.toISOString() : null,
    })),
    totalStepCount: checklist.totalStepCount,
  };
}

async function readReviewRequestState(shopDomain: string) {
  return prisma.reviewRequestState.findUnique({
    where: { shopDomain },
  });
}

function isPrismaUniqueError(error: unknown) {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "P2002"
  );
}

async function markReviewRequestAskedIfStillEligible({
  askedAt,
  shopDomain,
}: {
  askedAt: Date;
  shopDomain: string;
}) {
  const askedAtCooldownCutoff = addDays(askedAt, -REVIEW_PROMPT_REASK_INTERVAL_DAYS);

  try {
    await prisma.reviewRequestState.create({
      data: {
        askedAt,
        shopDomain,
      },
    });
    return true;
  } catch (error) {
    if (!isPrismaUniqueError(error)) {
      throw error;
    }
  }

  const updated = await prisma.reviewRequestState.updateMany({
    data: { askedAt },
    where: {
      dismissedPermanently: false,
      shopDomain,
      OR: [
        { askedAt: null },
        { askedAt: { lte: askedAtCooldownCutoff } },
      ],
    },
  });

  return updated.count === 1;
}

async function resolveReviewRequestForShop({
  entitlementState,
  onboardingComplete,
  shopDomain,
}: {
  entitlementState: string;
  onboardingComplete: boolean;
  shopDomain: string;
}): Promise<GrowthReviewRequestData> {
  const [growthState, reviewState] = await Promise.all([
    readGrowthState({ prismaClient: prisma, shopDomain }),
    readReviewRequestState(shopDomain),
  ]);
  const prompt = resolveReviewPrompt({
    activatedAt: growthState?.activatedAt ?? null,
    askedAt: reviewState?.askedAt ?? null,
    dismissedPermanently: reviewState?.dismissedPermanently ?? false,
    entitlementState,
    installedAt: growthState?.installedAt ?? null,
    onboardingComplete,
    reviewUrl: process.env.SHOPIFY_APP_REVIEW_URL,
  });

  return {
    actionUrl: prompt.shouldShow ? "/app/growth/review-request" : null,
    reason: prompt.reason,
    shouldShow: prompt.shouldShow,
  };
}

export async function loadGrowthHomeData({
  entitlement,
  shopDomain,
}: {
  entitlement: BillingEntitlement | null;
  shopDomain: string;
}): Promise<GrowthHomeData> {
  const entitlementState = entitlement?.state ?? "NOT_ENTITLED";
  const checklist = await readOnboardingChecklist({
    entitlementState,
    prismaClient: prisma,
    shopDomain,
  });
  const onboarding = serializeOnboardingChecklist(checklist);
  const reviewRequest = await resolveReviewRequestForShop({
    entitlementState,
    onboardingComplete: onboarding.isComplete,
    shopDomain,
  });

  return {
    onboarding,
    reviewRequest,
  };
}

export async function completeOnboardingStepAction({ request }: ActionFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const formData = await request.formData();
  const stepId = formData.get("stepId");

  if (
    typeof stepId !== "string"
    || !isOnboardingStepId(stepId)
    || !isMerchantCompletableOnboardingStepId(stepId)
  ) {
    return Response.json({ status: "invalid-step" } satisfies OnboardingActionData, {
      status: 400,
    });
  }

  await completeOnboardingStep({
    prismaClient: prisma,
    shopDomain: authContext.session.shop,
    stepId,
  });

  const growthState = await readGrowthState({
    prismaClient: prisma,
    shopDomain: authContext.session.shop,
  });
  const checklist = await readOnboardingChecklist({
    entitlementState: growthState?.lastEntitlementState ?? "NOT_ENTITLED",
    prismaClient: prisma,
    shopDomain: authContext.session.shop,
  });

  return Response.json({
    onboarding: serializeOnboardingChecklist(checklist),
    status: "completed",
  } satisfies OnboardingActionData);
}

export async function openReviewRequest({ request }: LoaderFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const shopDomain = authContext.session.shop;
  let entitlement: BillingEntitlement;

  try {
    entitlement = await queryPartnerApiBillingEntitlement({
      allowStaleFallback: false,
      forceRefresh: true,
      shopDomain,
    });
  } catch (error) {
    console.warn("Review request gate skipped because live Partner API entitlement check failed.", {
      error,
      shopDomain,
    });
    throw redirect("/app");
  }
  const growthState = await readGrowthState({ prismaClient: prisma, shopDomain });
  const checklist = await readOnboardingChecklist({
    entitlementState: entitlement.state,
    prismaClient: prisma,
    shopDomain,
  });
  const reviewState = await readReviewRequestState(shopDomain);
  const prompt = resolveReviewPrompt({
    activatedAt: growthState?.activatedAt ?? null,
    askedAt: reviewState?.askedAt ?? null,
    dismissedPermanently: reviewState?.dismissedPermanently ?? false,
    entitlementState: entitlement.state,
    installedAt: growthState?.installedAt ?? null,
    onboardingComplete: checklist.isComplete,
    reviewUrl: process.env.SHOPIFY_APP_REVIEW_URL,
  });

  if (!prompt.shouldShow || !process.env.SHOPIFY_APP_REVIEW_URL) {
    throw redirect("/app");
  }

  const askedAt = new Date();
  const markedAsked = await markReviewRequestAskedIfStillEligible({
    askedAt,
    shopDomain,
  });

  if (!markedAsked) {
    throw redirect("/app");
  }

  throw redirect(process.env.SHOPIFY_APP_REVIEW_URL);
}

export async function dismissReviewRequest({ request }: ActionFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);

  await prisma.reviewRequestState.upsert({
    create: {
      dismissedAt: new Date(),
      dismissedPermanently: true,
      shopDomain: authContext.session.shop,
    },
    update: {
      dismissedAt: new Date(),
      dismissedPermanently: true,
    },
    where: { shopDomain: authContext.session.shop },
  });

  return Response.json({ status: "dismissed" } satisfies ReviewRequestActionData);
}

export async function loadWeeklyFunnelSummary({ request }: LoaderFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const shopHash = resolveFunnelShopHash({
    shopDomain: authContext.session.shop,
  });

  if (!shopHash) {
    return Response.json(buildEmptyWeeklyFunnelSummary());
  }

  return Response.json(await queryWeeklyFunnelSummary({ prismaClient: prisma, shopHash }));
}
