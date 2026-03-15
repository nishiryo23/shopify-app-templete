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
  findLatestSuccessfulProductWriteArtifact,
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
    throw new Error("file upload is required");
  }

  return {
    body: Buffer.from(await file.arrayBuffer()),
    name: file.name,
  };
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
    throw new Error("selected export job is not a completed product export for this shop");
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
    throw new Error("selected export job is missing source or manifest artifact");
  }

  return {
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

  if (!exportJobId) {
    return json({ error: "exportJobId is required" }, { status: 400 });
  }

  try {
    const [{ body: sourceBody }, { body: editedBody }] = await Promise.all([
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
      throw new Error("selected export baseline body could not be read");
    }

    if (sha256Hex(sourceBody) !== baseline.sourceArtifact.checksumSha256) {
      throw new Error("source CSV does not match the selected export baseline");
    }

    if (!sourceBody.equals(storedSourceBody)) {
      throw new Error("source CSV must be the original exported file without edits");
    }

    const verification = verifyCsvManifest({
      csvText: sourceBody.toString("utf8"),
      manifest: JSON.parse(manifestBody.toString("utf8")),
      signingKey: requireProvenanceSigningKey(),
    });

    if (!verification.ok) {
      throw new Error(`source provenance verification failed: ${verification.reason}`);
    }

    const editedDigest = sha256Hex(editedBody);
    let createdArtifact = null;

    try {
      const existingActiveJob = await prisma.job.findFirst({
        orderBy: [{ createdAt: "desc" }],
        where: {
          dedupeKey: `product-preview:${exportJobId}:${editedDigest}`,
          kind: PRODUCT_PREVIEW_KIND,
          shopDomain,
          state: { in: ["queued", "retryable", "leased"] },
        },
      });

      if (existingActiveJob) {
        return json({
          exportJobId,
          jobId: existingActiveJob.id,
          kind: PRODUCT_PREVIEW_KIND,
          profile: baseline.profile,
          state: existingActiveJob.state,
        }, { status: 202 });
      }

      const artifactKey = buildProductPreviewArtifactKey({
        fileName: "edited.csv",
        jobId: crypto.randomUUID(),
        prefix: process.env.S3_ARTIFACT_PREFIX,
        shopDomain,
      });
      const descriptor = await artifactStorage.put({
        body: editedBody,
        contentType: "text/csv; charset=utf-8",
        key: artifactKey,
        metadata: {
          editedDigest,
          exportJobId,
          profile: baseline.profile,
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
        editedUploadArtifactId: createdArtifact.id,
        exportJobId,
        jobQueue,
        manifestArtifactId: baseline.manifestArtifact.id,
        prisma,
        profile: baseline.profile,
        shopDomain,
        sourceArtifactId: baseline.sourceArtifact.id,
      });

      if (!job) {
        throw new Error("Failed to enqueue product preview job");
      }

      if (job.payload?.editedUploadArtifactId !== createdArtifact.id) {
        await deleteArtifactIfPresent(createdArtifact);
      }

      return json({
        exportJobId,
        jobId: job.id,
        kind: PRODUCT_PREVIEW_KIND,
        profile: baseline.profile,
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
      error: error instanceof Error ? error.message : "product preview request failed",
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
    throw new Error("preview result artifact body could not be read");
  }

  const payload = JSON.parse(resultBody.toString("utf8"));
  return {
    jobState: job.state,
    lastError: job.lastError,
    rows: payload.rows,
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
    throw new Error("artifact body could not be read");
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
  const artifact = await findLatestSuccessfulProductWriteArtifact({
    prisma,
    profile,
    shopDomain,
  });

  if (!artifact) {
    return null;
  }

  return {
    outcome: (artifact.metadata as { outcome?: string } | null)?.outcome ?? null,
    previewJobId: (artifact.metadata as { previewJobId?: string } | null)?.previewJobId ?? null,
    total: (artifact.metadata as { total?: number } | null)?.total ?? null,
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
      id: job.id,
      profile: (job.payload as { profile?: string } | null)?.profile ?? PRODUCT_CORE_SEO_EXPORT_PROFILE,
    })),
    isAccountOwner: session.accountOwner === true,
    latestWrite: await loadLatestSuccessfulWrite(shopDomain, profile),
    preview: previewJobId ? await loadPreviewJobDetail({ jobId: previewJobId, shopDomain }) : null,
    selectedProfile: profile,
    undo: undoJobId ? await loadUndoJobDetail({ jobId: undoJobId, shopDomain }) : null,
    write: writeJobId ? await loadWriteJobDetail({ jobId: writeJobId, shopDomain }) : null,
  });
}
