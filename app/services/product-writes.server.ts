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
    error: "latest rollbackable write retention has expired",
  }, { status: 400 });
}

async function requireOwnerPaidAction(request: Request) {
  const authContext = await authenticateAndBootstrapShop(request);
  const session = authContext.session as unknown as AdminSession;
  const entitlement = await queryCurrentAppInstallationEntitlement(authContext.admin, {
    shopDomain: session.shop,
  });

  if (session.accountOwner !== true) {
    throw new Error("owner confirmation is required");
  }

  if (entitlement.state !== "ACTIVE_PAID") {
    throw new Error("ACTIVE_PAID entitlement is required");
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
    throw new Error("selected preview job is not a completed product preview for this shop");
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
    throw new Error("selected preview job is missing result artifact");
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
      return json({ error: "previewJobId is required" }, { status: 400 });
    }

    const shopDomain = authContext.session.shop;
    const preview = await loadCompletedPreviewOrThrow({ previewJobId, shopDomain });
    const previewPayload = preview.artifact.metadata as { previewDigest?: string } | null;
    const previewFile = await artifactStorage.get(preview.artifact.objectKey);
    const previewBody = Buffer.isBuffer(previewFile) ? previewFile : previewFile?.body;

    if (!previewBody) {
      throw new Error("preview result artifact body could not be read");
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
      return json({ error: "this preview already has a verified successful write" }, { status: 409 });
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
      return json({ error: "preview contains error rows and cannot be confirmed" }, { status: 400 });
    }
    if (!rowState.hasWritableRows) {
      return json({ error: "preview does not contain writable rows" }, { status: 400 });
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
      throw new Error("Failed to enqueue product write job");
    }

    return json({
      jobId: job.id,
      kind: "product.write",
      previewJobId,
      state: job.state,
    }, { status: 202 });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "product write request failed",
    }, { status: 400 });
  }
}

export async function createProductUndo({ request }: ActionFunctionArgs) {
  try {
    const authContext = await requireOwnerPaidAction(request);
    const formData = await request.formData();
    const writeJobId = String(formData.get("writeJobId") ?? "").trim();

    if (!writeJobId) {
      return json({ error: "writeJobId is required" }, { status: 400 });
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
      return json({ error: "undo is only allowed for the latest rollbackable write" }, { status: 400 });
    }

    if (latestRollbackableWrite.retentionExpired) {
      return retentionExpiredUndoResponse();
    }

    const snapshotArtifact = latestRollbackableWrite.snapshotArtifact;

    if (!snapshotArtifact) {
      return json({ error: "latest rollbackable write is missing snapshot artifact" }, { status: 400 });
    }

    const profile = (latestRollbackableWrite.artifact.metadata as { profile?: string } | null)?.profile ?? PRODUCT_CORE_SEO_EXPORT_PROFILE;
    if (profile !== PRODUCT_CORE_SEO_EXPORT_PROFILE) {
      return json({ error: "undo is not available for this write profile" }, { status: 400 });
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
      throw new Error("Failed to enqueue product undo job");
    }

    return json({
      jobId: job.id,
      kind: PRODUCT_UNDO_KIND,
      state: job.state,
      writeJobId,
    }, { status: 202 });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "product undo request failed",
    }, { status: 400 });
  }
}
