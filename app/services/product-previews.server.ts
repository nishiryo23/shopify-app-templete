import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import crypto from "node:crypto";
import type { Job } from "@prisma/client";

import prisma from "../db.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import { queryCurrentAppInstallationEntitlement } from "./billing.server";
import { createArtifactStorageFromEnv } from "~/domain/artifacts/factory.mjs";
import { createPrismaArtifactCatalog } from "~/domain/artifacts/prisma-artifact-catalog.mjs";
import { createPrismaJobQueue } from "~/domain/jobs/prisma-job-queue.mjs";
import {
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_EXPORT_FORMAT,
  resolveProductExportProfile,
} from "~/domain/products/export-profile.mjs";
import { enqueueOrFindActiveProductPreviewJob } from "~/domain/products/preview-jobs.mjs";
import { filterPreviewableExportJobs } from "~/domain/products/preview-baselines.mjs";
import {
  buildProductPreviewArtifactKey,
  PRODUCT_PREVIEW_EDITED_UPLOAD_ARTIFACT_KIND,
  PRODUCT_PREVIEW_KIND,
  PRODUCT_PREVIEW_RESULT_ARTIFACT_KIND,
} from "~/domain/products/preview-profile.mjs";
import {
  assertProductSpreadsheetFileName,
  canonicalizeProductSpreadsheet,
  getProductSpreadsheetContentType,
  getProductSpreadsheetFileName,
  PRODUCT_SPREADSHEET_LAYOUT_CANONICAL,
  PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY,
  resolveProductSpreadsheetFormatFromFileName,
} from "~/domain/products/spreadsheet-format.mjs";
import {
  findLatestRollbackableWriteState,
  findVerifiedSuccessfulProductWriteArtifactByPreviewJobId,
} from "~/domain/products/write-jobs.mjs";
import {
  PRODUCT_UNDO_ERROR_ARTIFACT_KIND,
  PRODUCT_UNDO_KIND,
  PRODUCT_UNDO_RESULT_ARTIFACT_KIND,
  PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
  PRODUCT_WRITE_KIND,
  PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
} from "~/domain/products/write-profile.mjs";
import { verifyCsvManifest } from "~/domain/provenance/csv-manifest.mjs";
import { requireProvenanceSigningKey, sha256Hex } from "~/domain/provenance/signing.mjs";

const artifactStorage: any = createArtifactStorageFromEnv();
const artifactCatalog: any = createPrismaArtifactCatalog(prisma);
const jobQueue = createPrismaJobQueue(prisma);

type AdminSession = {
  accountOwner?: boolean;
  shop: string;
};

type CompletedExportBaselineArgs = {
  exportJobId: string;
  shopDomain: string;
};

function extractArtifactBody(record: unknown) {
  if (Buffer.isBuffer(record)) {
    return record;
  }

  if (record && typeof record === "object" && "body" in record) {
    return record.body as Buffer;
  }

  return null;
}

function json(data: unknown, init?: { headers?: Record<string, string>; status?: number }) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

async function readFileText(file: File | null) {
  if (!(file instanceof File)) {
    throw new Error("ファイルのアップロードが必要です");
  }

  return {
    body: Buffer.from(await file.arrayBuffer()),
    name: file.name,
  };
}

function resolveEditedLayout(value: unknown) {
  return String(value ?? "").trim().toLowerCase() === PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY
    ? PRODUCT_SPREADSHEET_LAYOUT_MATRIXIFY
    : PRODUCT_SPREADSHEET_LAYOUT_CANONICAL;
}

async function loadCompletedExportBaseline({
  exportJobId,
  shopDomain,
}: CompletedExportBaselineArgs) {
  const job = await prisma.job.findFirst({
    where: {
      id: exportJobId,
      kind: "product.export",
      shopDomain,
      state: "completed",
    },
  });

  if (!job) {
    throw new Error("選択したエクスポートジョブは、このショップの完了済み商品エクスポートではありません");
  }

  const [sourceArtifact, manifestArtifact] = await Promise.all([
    prisma.artifact.findFirst({
      where: {
        deletedAt: null,
        jobId: exportJobId,
        kind: "product.export.source",
        shopDomain,
      },
    }),
    prisma.artifact.findFirst({
      where: {
        deletedAt: null,
        jobId: exportJobId,
        kind: "product.export.manifest",
        shopDomain,
      },
    }),
  ]);

  if (!sourceArtifact || !manifestArtifact) {
    throw new Error("選択したエクスポートジョブに原本または manifest artifact がありません");
  }

  return {
    format: (job.payload as { format?: string } | null)?.format ?? PRODUCT_EXPORT_FORMAT,
    job,
    manifestArtifact,
    profile: (job.payload as { profile?: string } | null)?.profile ?? PRODUCT_CORE_SEO_EXPORT_PROFILE,
    sourceArtifact,
  };
}

async function deleteArtifactIfPresent(artifact: { bucket: string; objectKey: string } | null) {
  if (!artifact) {
    return;
  }

  await Promise.allSettled([
    artifactStorage.delete(artifact.objectKey),
    artifactCatalog.markDeleted({
      bucket: artifact.bucket,
      objectKey: artifact.objectKey,
    }),
  ]);
}

export async function createProductPreview({ request }: ActionFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const formData = await request.formData();
  const exportJobId = String(formData.get("exportJobId") ?? "").trim();
  const editedLayout = resolveEditedLayout(formData.get("editedLayout"));

  if (!exportJobId) {
    return json({ error: "エクスポートジョブを選択してください" }, { status: 400 });
  }

  try {
    const [{ body: sourceBody, name: sourceName }, { body: editedBody, name: editedName }] = await Promise.all([
      readFileText(formData.get("sourceFile") as File | null),
      readFileText(formData.get("editedFile") as File | null),
    ]);
    const shopDomain = authContext.session.shop;
    const baseline = await loadCompletedExportBaseline({
      exportJobId,
      shopDomain,
    });
    const [manifestRecord, sourceRecord] = await Promise.all([
      artifactStorage.get(baseline.manifestArtifact.objectKey),
      artifactStorage.get(baseline.sourceArtifact.objectKey),
    ]);
    const manifestBody = extractArtifactBody(manifestRecord);
    const storedSourceBody = extractArtifactBody(sourceRecord);

    if (!manifestBody || !storedSourceBody) {
      throw new Error("選択したエクスポート元ファイルを読み取れませんでした");
    }

    const sourceFormat = baseline.format;
    const inferredEditedFormat = resolveProductSpreadsheetFormatFromFileName(editedName);
    let editedFormat = sourceFormat;
    assertProductSpreadsheetFileName({
      fileName: sourceName,
      format: sourceFormat,
      role: "source",
    });
    if (editedLayout === PRODUCT_SPREADSHEET_LAYOUT_CANONICAL) {
      assertProductSpreadsheetFileName({
        fileName: editedName,
        format: sourceFormat,
        role: "edited",
      });
    } else if (!inferredEditedFormat) {
      throw new Error("Matrixify 互換モードでは、編集ファイルは .csv または .xlsx 拡張子である必要があります");
    } else {
      editedFormat = inferredEditedFormat;
    }

    const sourceCanonical = await canonicalizeProductSpreadsheet({
      body: sourceBody,
      format: sourceFormat,
      layout: PRODUCT_SPREADSHEET_LAYOUT_CANONICAL,
      profile: baseline.profile,
    });
    const editedCanonical = await canonicalizeProductSpreadsheet({
      baselineCanonicalCsvText: sourceCanonical.canonicalCsvText,
      body: editedBody,
      format: editedFormat,
      layout: editedLayout,
      profile: baseline.profile,
    });

    const verification = verifyCsvManifest({
      csvText: sourceCanonical.canonicalCsvText,
      manifest: JSON.parse(manifestBody.toString("utf8")),
      signingKey: requireProvenanceSigningKey(),
    });

    if (!verification.ok) {
      throw new Error(`原本ファイルの整合性を確認できませんでした: ${verification.reason}`);
    }

    const editedDigest = sha256Hex(editedCanonical.canonicalCsvText);
    const editedRowMapDigest = editedCanonical.editedRowMapDigest;
    let createdArtifact = null;

    try {
      const existingActiveJob = await prisma.job.findFirst({
        orderBy: [{ createdAt: "desc" }],
        where: {
          dedupeKey: `product-preview:${exportJobId}:${editedLayout}:${editedDigest}:${editedRowMapDigest}`,
          kind: PRODUCT_PREVIEW_KIND,
          shopDomain,
          state: { in: ["queued", "retryable", "leased"] },
        },
      });

      if (existingActiveJob) {
        return json({
          editedFormat,
          editedLayout,
          exportJobId,
          format: sourceFormat,
          jobId: existingActiveJob.id,
          kind: PRODUCT_PREVIEW_KIND,
          profile: baseline.profile,
          sourceFormat,
          state: existingActiveJob.state,
        }, { status: 202 });
      }

      const artifactKey = buildProductPreviewArtifactKey({
        fileName: getProductSpreadsheetFileName({ format: editedFormat, kind: "edited" }),
        jobId: crypto.randomUUID(),
        prefix: process.env.S3_ARTIFACT_PREFIX,
        shopDomain,
      });
      const descriptor = await artifactStorage.put({
        body: editedBody,
        contentType: getProductSpreadsheetContentType(editedFormat),
        key: artifactKey,
        metadata: {
          editedDigest,
          editedFormat,
          editedLayout,
          editedRowMapDigest,
          exportJobId,
          profile: baseline.profile,
          sourceFormat,
        } as never,
      });

      createdArtifact = await artifactCatalog.record({
        ...descriptor,
        kind: PRODUCT_PREVIEW_EDITED_UPLOAD_ARTIFACT_KIND,
        metadata: descriptor.metadata,
        retentionUntil: null,
        shopDomain,
      });

      const job = await enqueueOrFindActiveProductPreviewJob({
        editedDigest,
        editedFormat,
        editedLayout,
        editedRowMapDigest,
        editedUploadArtifactId: createdArtifact.id,
        exportJobId,
        jobQueue,
        manifestArtifactId: baseline.manifestArtifact.id,
        prisma,
        profile: baseline.profile,
        shopDomain,
        sourceFormat,
        sourceArtifactId: baseline.sourceArtifact.id,
      });

      if (!job) {
        throw new Error("商品プレビュージョブの登録に失敗しました");
      }

      if (job.payload?.editedUploadArtifactId !== createdArtifact.id) {
        await deleteArtifactIfPresent(createdArtifact);
      }

    return json({
      editedFormat,
      editedLayout,
      exportJobId,
        format: sourceFormat,
        jobId: job.id,
        kind: PRODUCT_PREVIEW_KIND,
        profile: baseline.profile,
        sourceFormat,
        state: job.state,
      }, { status: 202 });
    } catch (error) {
      if (createdArtifact) {
        await deleteArtifactIfPresent(createdArtifact);
      }

      throw error;
    }
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "商品プレビューのリクエストに失敗しました",
    }, { status: 400 });
  }
}

async function loadLatestCompletedExports(shopDomain: string, profile: string) {
  const matchingJobs = [];
  const take = 20;
  let skip = 0;

  while (matchingJobs.length < 20) {
    const jobs = await prisma.job.findMany({
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
      where: {
        kind: "product.export",
        shopDomain,
        state: "completed",
      },
    });

    if (jobs.length === 0) {
      break;
    }

    matchingJobs.push(...jobs.filter(
      (job: Job) => ((job.payload as { profile?: string } | null)?.profile ?? PRODUCT_CORE_SEO_EXPORT_PROFILE) === profile,
    ));
    skip += jobs.length;
  }

  const artifacts = await prisma.artifact.findMany({
    where: {
      deletedAt: null,
      jobId: { in: matchingJobs.map((job) => job.id) },
      kind: { in: ["product.export.source", "product.export.manifest"] },
      shopDomain,
    },
  });

  return filterPreviewableExportJobs({ artifacts, jobs: matchingJobs }).slice(0, 20);
}

async function loadPreviewJobDetail({ jobId, shopDomain }: { jobId: string; shopDomain: string }) {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      kind: PRODUCT_PREVIEW_KIND,
      shopDomain,
    },
  });

  if (!job) {
    return null;
  }

  const resultArtifact = await prisma.artifact.findFirst({
    where: {
      deletedAt: null,
      jobId,
      kind: PRODUCT_PREVIEW_RESULT_ARTIFACT_KIND,
      shopDomain,
    },
  });

  if (!resultArtifact) {
    return {
      jobState: job.state,
      lastError: job.lastError,
      rows: null,
      summary: null,
    };
  }

  const resultRecord = await artifactStorage.get(resultArtifact.objectKey);
  const resultBody = extractArtifactBody(resultRecord);

  if (!resultBody) {
    throw new Error("プレビュー結果 artifact の内容を読み取れませんでした");
  }

  const payload = JSON.parse(resultBody.toString("utf8"));
  return {
    editedFormat: payload.editedFormat ?? PRODUCT_EXPORT_FORMAT,
    editedLayout: payload.editedLayout ?? PRODUCT_SPREADSHEET_LAYOUT_CANONICAL,
    jobState: job.state,
    lastError: job.lastError,
    rows: payload.rows,
    sourceFormat: payload.sourceFormat ?? PRODUCT_EXPORT_FORMAT,
    summary: payload.summary,
  };
}

async function loadTerminalJobArtifacts({
  errorKind,
  jobId,
  resultKind,
  shopDomain,
}: {
  errorKind: string;
  jobId: string;
  resultKind: string;
  shopDomain: string;
}) {
  const [resultArtifact, errorArtifact] = await Promise.all([
    prisma.artifact.findFirst({
      where: {
        deletedAt: null,
        jobId,
        kind: resultKind,
        shopDomain,
      },
    }),
    prisma.artifact.findFirst({
      where: {
        deletedAt: null,
        jobId,
        kind: errorKind,
        shopDomain,
      },
    }),
  ]);

  return {
    errorArtifact,
    resultArtifact,
  };
}

async function loadJsonArtifactPayload(artifact: { objectKey: string } | null) {
  if (!artifact) {
    return null;
  }

  const record = await artifactStorage.get(artifact.objectKey);
  const body = extractArtifactBody(record);

  if (!body) {
    throw new Error("artifact の内容を読み取れませんでした");
  }

  return JSON.parse(body.toString("utf8"));
}

async function loadWriteJobDetail({ jobId, shopDomain }: { jobId: string; shopDomain: string }) {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      kind: PRODUCT_WRITE_KIND,
      shopDomain,
    },
  });

  if (!job) {
    return null;
  }

  const { errorArtifact, resultArtifact } = await loadTerminalJobArtifacts({
    errorKind: PRODUCT_WRITE_ERROR_ARTIFACT_KIND,
    jobId,
    resultKind: PRODUCT_WRITE_RESULT_ARTIFACT_KIND,
    shopDomain,
  });

  const [resultPayload, errorPayload] = await Promise.all([
    loadJsonArtifactPayload(resultArtifact),
    loadJsonArtifactPayload(errorArtifact),
  ]);

  return {
    jobState: job.state,
    lastError: errorPayload?.message ?? job.lastError,
    outcome: resultPayload?.outcome ?? null,
    summary: resultPayload?.summary ?? null,
    writeJobId: job.id,
  };
}

async function loadUndoJobDetail({ jobId, shopDomain }: { jobId: string; shopDomain: string }) {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      kind: PRODUCT_UNDO_KIND,
      shopDomain,
    },
  });

  if (!job) {
    return null;
  }

  const { errorArtifact, resultArtifact } = await loadTerminalJobArtifacts({
    errorKind: PRODUCT_UNDO_ERROR_ARTIFACT_KIND,
    jobId,
    resultKind: PRODUCT_UNDO_RESULT_ARTIFACT_KIND,
    shopDomain,
  });
  const [resultPayload, errorPayload] = await Promise.all([
    loadJsonArtifactPayload(resultArtifact),
    loadJsonArtifactPayload(errorArtifact),
  ]);

  return {
    jobState: job.state,
    lastError: errorPayload?.message ?? job.lastError,
    outcome: resultPayload?.outcome ?? null,
    summary: resultPayload?.summary ?? null,
    undoJobId: job.id,
  };
}

async function loadLatestSuccessfulWrite(shopDomain: string, profile: string) {
  const state = await findLatestRollbackableWriteState({
    prisma,
    profile,
    shopDomain,
  });

  if (!state) {
    return null;
  }

  return {
    outcome: (state.artifact.metadata as { outcome?: string } | null)?.outcome ?? null,
    previewJobId: (state.artifact.metadata as { previewJobId?: string } | null)?.previewJobId ?? null,
    retentionExpired: state.retentionExpired,
    total: (state.artifact.metadata as { total?: number } | null)?.total ?? null,
    writeJobId: state.artifact.jobId,
  };
}

async function loadSelectedPreviewVerifiedWrite({
  previewJobId,
  profile,
  shopDomain,
}: {
  previewJobId: string | null;
  profile: string;
  shopDomain: string;
}) {
  if (!previewJobId) {
    return null;
  }

  const artifact = await findVerifiedSuccessfulProductWriteArtifactByPreviewJobId({
    previewJobId,
    prisma,
    profile,
    shopDomain,
  });

  if (!artifact) {
    return null;
  }

  return {
    writeJobId: artifact.jobId,
  };
}

export async function loadProductPreviewPage({ request }: LoaderFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const session = authContext.session as unknown as AdminSession;
  const url = new URL(request.url);
  const profile = resolveProductExportProfile(url.searchParams.get("profile") ?? "");
  const previewJobId = url.searchParams.get("previewJobId") ?? url.searchParams.get("jobId");
  const writeJobId = url.searchParams.get("writeJobId");
  const undoJobId = url.searchParams.get("undoJobId");
  const shopDomain = session.shop;
  const entitlement = await queryCurrentAppInstallationEntitlement(authContext.admin, {
    shopDomain,
  });

  return json({
    entitlementState: entitlement.state,
    exports: (await loadLatestCompletedExports(shopDomain, profile)).map((job: Job) => ({
      createdAt: job.createdAt.toISOString(),
      format: (job.payload as { format?: string } | null)?.format ?? PRODUCT_EXPORT_FORMAT,
      id: job.id,
      profile: (job.payload as { profile?: string } | null)?.profile ?? PRODUCT_CORE_SEO_EXPORT_PROFILE,
    })),
    isAccountOwner: session.accountOwner === true,
    latestWrite: await loadLatestSuccessfulWrite(shopDomain, profile),
    preview: previewJobId ? await loadPreviewJobDetail({ jobId: previewJobId, shopDomain }) : null,
    selectedPreviewVerifiedWrite: await loadSelectedPreviewVerifiedWrite({
      previewJobId,
      profile,
      shopDomain,
    }),
    selectedProfile: profile,
    undo: undoJobId ? await loadUndoJobDetail({ jobId: undoJobId, shopDomain }) : null,
    write: writeJobId ? await loadWriteJobDetail({ jobId: writeJobId, shopDomain }) : null,
  });
}
