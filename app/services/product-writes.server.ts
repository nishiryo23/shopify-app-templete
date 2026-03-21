import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import { queryCurrentAppInstallationEntitlement } from "./billing.server";
import { createArtifactStorageFromEnv } from "~/domain/artifacts/factory.mjs";
import { createPrismaJobQueue } from "~/domain/jobs/prisma-job-queue.mjs";
import {
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
} from "~/domain/products/export-profile.mjs";
import {
  enqueueOrFindActiveProductUndoJob,
  enqueueOrFindActiveProductWriteJob,
  findActiveProductUndoJob,
  findLatestRollbackableWriteState,
  findVerifiedSuccessfulProductWriteArtifactByPreviewJobId,
} from "~/domain/products/write-jobs.mjs";
import {
  PRODUCT_UNDO_KIND,
} from "~/domain/products/write-profile.mjs";

const jobQueue = createPrismaJobQueue(prisma);
const artifactStorage: any = createArtifactStorageFromEnv();

type AdminSession = {
  accountOwner?: boolean;
  email?: string | null;
  shop: string;
  userId?: bigint | number | string | null;
};

function json(data: unknown, init?: { headers?: Record<string, string>; status?: number }) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

function retentionExpiredUndoResponse() {
  return json({
    code: "retention_expired",
    error: "最新のロールバック可能な書き戻しは保持期限切れです",
  }, { status: 400 });
}

async function requireOwnerPaidAction(request: Request) {
  const authContext = await authenticateAndBootstrapShop(request);
  const session = authContext.session as unknown as AdminSession;
  const entitlement = await queryCurrentAppInstallationEntitlement(authContext.admin, {
    shopDomain: session.shop,
  });

  if (session.accountOwner !== true) {
    throw new Error("ショップオーナーによる確定が必要です");
  }

  if (entitlement.state !== "ACTIVE_PAID") {
    throw new Error("有効な契約が必要です");
  }

  return {
    ...authContext,
    session,
  };
}

async function loadCompletedPreviewOrThrow({
  previewJobId,
  shopDomain,
}: {
  previewJobId: string;
  shopDomain: string;
}) {
  const job = await prisma.job.findFirst({
    where: {
      id: previewJobId,
      kind: "product.preview",
      shopDomain,
      state: "completed",
    },
  });

  if (!job) {
    throw new Error("選択したプレビュージョブは、このショップの完了済み商品プレビューではありません");
  }

  const artifact = await prisma.artifact.findFirst({
    where: {
      deletedAt: null,
      jobId: previewJobId,
      kind: "product.preview.result",
      shopDomain,
    },
  });

  if (!artifact) {
    throw new Error("選択したプレビュージョブに結果 artifact がありません");
  }

  return {
    artifact,
    job,
  };
}

async function readLatestRollbackableWriteOrNull(shopDomain: string) {
  return findLatestRollbackableWriteState({
    prisma,
    profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
    shopDomain,
  });
}

function findPreviewJobRows(payload: { rows?: Array<{ changedFields?: string[] }>; summary?: { error?: number } } | null) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const hasWritableRows = rows.some((row) => Array.isArray(row?.changedFields) && row.changedFields.length > 0);
  return {
    hasWritableRows,
    hasErrors: (payload?.summary?.error ?? 0) > 0,
  };
}

export async function createProductWrite({ request }: ActionFunctionArgs) {
  try {
    const authContext = await requireOwnerPaidAction(request);
    const formData = await request.formData();
    const previewJobId = String(formData.get("previewJobId") ?? "").trim();

    if (!previewJobId) {
      return json({ error: "プレビューを選択してください" }, { status: 400 });
    }

    const shopDomain = authContext.session.shop;
    const preview = await loadCompletedPreviewOrThrow({ previewJobId, shopDomain });
    const previewPayload = preview.artifact.metadata as { previewDigest?: string } | null;
    const previewFile = await artifactStorage.get(preview.artifact.objectKey);
    const previewBody = Buffer.isBuffer(previewFile) ? previewFile : previewFile?.body;

    if (!previewBody) {
      throw new Error("プレビュー結果を読み取れませんでした");
    }

    const payload = JSON.parse(previewBody.toString("utf8"));
    const profile = payload.profile ?? PRODUCT_CORE_SEO_EXPORT_PROFILE;
    const existingVerifiedSuccess = await findVerifiedSuccessfulProductWriteArtifactByPreviewJobId({
      previewJobId,
      prisma,
      profile,
      shopDomain,
    });
    if (existingVerifiedSuccess) {
      return json({ error: "このプレビューには、すでに検証済みの成功書き込みがあります" }, { status: 409 });
    }

    const existingActiveJob = await prisma.job.findFirst({
      orderBy: [{ createdAt: "desc" }],
      where: {
        dedupeKey: `product-write:${previewJobId}`,
        kind: "product.write",
        shopDomain,
        state: { in: ["queued", "retryable", "leased"] },
      },
    });

    if (existingActiveJob) {
      return json({
        jobId: existingActiveJob.id,
        kind: "product.write",
        previewJobId,
        state: existingActiveJob.state,
      }, { status: 202 });
    }

    const rowState = findPreviewJobRows(payload);
    if (rowState.hasErrors) {
      return json({ error: "プレビューにエラー行が含まれているため確定できません" }, { status: 400 });
    }
    if (!rowState.hasWritableRows) {
      return json({ error: "プレビューに書き込み対象の行がありません" }, { status: 400 });
    }

    const job = await enqueueOrFindActiveProductWriteJob({
      confirmedBy: {
        email: authContext.session.email ?? null,
        userId: authContext.session.userId?.toString() ?? null,
      },
      jobQueue,
      previewArtifactId: preview.artifact.id,
      previewDigest: payload.previewDigest ?? previewPayload?.previewDigest ?? null,
      previewJobId,
      prisma,
      profile,
      shopDomain,
    });

    if (!job) {
      throw new Error("商品書き込みジョブの登録に失敗しました");
    }

    return json({
      jobId: job.id,
      kind: "product.write",
      previewJobId,
      state: job.state,
    }, { status: 202 });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "商品書き込みのリクエストに失敗しました",
    }, { status: 400 });
  }
}

export async function createProductUndo({ request }: ActionFunctionArgs) {
  try {
    const authContext = await requireOwnerPaidAction(request);
    const formData = await request.formData();
    const writeJobId = String(formData.get("writeJobId") ?? "").trim();

    if (!writeJobId) {
      return json({ error: "取り消し対象の書き込みを選択してください" }, { status: 400 });
    }

    const shopDomain = authContext.session.shop;

    const activeUndo = await findActiveProductUndoJob({
      prisma,
      shopDomain,
      writeJobId,
    });

    if (activeUndo) {
      return json({
        jobId: activeUndo.id,
        kind: PRODUCT_UNDO_KIND,
        state: activeUndo.state,
        writeJobId,
      }, { status: 202 });
    }

    const latestRollbackableWrite = await readLatestRollbackableWriteOrNull(shopDomain);

    if (!latestRollbackableWrite || latestRollbackableWrite.artifact.jobId !== writeJobId) {
      return json({ error: "取り消しは最新のロールバック可能な書き戻しに対してのみ実行できます" }, { status: 400 });
    }

    if (latestRollbackableWrite.retentionExpired) {
      return retentionExpiredUndoResponse();
    }

    const snapshotArtifact = latestRollbackableWrite.snapshotArtifact;

    if (!snapshotArtifact) {
      return json({ error: "取り消しに必要な復元データが見つかりません" }, { status: 400 });
    }

    const profile = (latestRollbackableWrite.artifact.metadata as { profile?: string } | null)?.profile ?? PRODUCT_CORE_SEO_EXPORT_PROFILE;
    if (profile !== PRODUCT_CORE_SEO_EXPORT_PROFILE) {
      return json({ error: "この書き込みプロファイルでは取り消しを利用できません" }, { status: 400 });
    }

    const job = await enqueueOrFindActiveProductUndoJob({
      jobQueue,
      prisma,
      profile,
      requestedBy: {
        email: authContext.session.email ?? null,
        userId: authContext.session.userId?.toString() ?? null,
      },
      shopDomain,
      snapshotArtifactId: snapshotArtifact.id,
      writeArtifactId: latestRollbackableWrite.artifact.id,
      writeJobId,
    });

    if (!job) {
      throw new Error("商品取り消しジョブの登録に失敗しました");
    }

    return json({
      jobId: job.id,
      kind: PRODUCT_UNDO_KIND,
      state: job.state,
      writeJobId,
    }, { status: 202 });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "商品取り消しのリクエストに失敗しました",
    }, { status: 400 });
  }
}
