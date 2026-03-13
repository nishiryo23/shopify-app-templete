import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import crypto from "node:crypto";
import type { Job } from "@prisma/client";

import prisma from "../db.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import { createArtifactStorageFromEnv } from "~/domain/artifacts/factory.mjs";
import { createPrismaArtifactCatalog } from "~/domain/artifacts/prisma-artifact-catalog.mjs";
import { createPrismaJobQueue } from "~/domain/jobs/prisma-job-queue.mjs";
import { PRODUCT_CORE_SEO_EXPORT_PROFILE } from "~/domain/products/export-profile.mjs";
import { enqueueOrFindActiveProductPreviewJob } from "~/domain/products/preview-jobs.mjs";
import { filterPreviewableExportJobs } from "~/domain/products/preview-baselines.mjs";
import {
  buildProductPreviewArtifactKey,
  PRODUCT_PREVIEW_EDITED_UPLOAD_ARTIFACT_KIND,
  PRODUCT_PREVIEW_KIND,
  PRODUCT_PREVIEW_RESULT_ARTIFACT_KIND,
} from "~/domain/products/preview-profile.mjs";
import { verifyCsvManifest } from "~/domain/provenance/csv-manifest.mjs";
import { requireProvenanceSigningKey, sha256Hex } from "~/domain/provenance/signing.mjs";

const artifactStorage: any = createArtifactStorageFromEnv();
const artifactCatalog: any = createPrismaArtifactCatalog(prisma);
const jobQueue = createPrismaJobQueue(prisma);

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
          profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
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
          profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
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
        profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
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
        profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
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

async function loadLatestCompletedExports(shopDomain: string) {
  const jobs = await prisma.job.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 10,
    where: {
      kind: "product.export",
      shopDomain,
      state: "completed",
    },
  });

  if (jobs.length === 0) {
    return [];
  }

  const artifacts = await prisma.artifact.findMany({
    where: {
      deletedAt: null,
      jobId: { in: jobs.map((job) => job.id) },
      kind: { in: ["product.export.source", "product.export.manifest"] },
      shopDomain,
    },
  });

  return filterPreviewableExportJobs({ artifacts, jobs });
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

export async function loadProductPreviewPage({ request }: LoaderFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const shopDomain = authContext.session.shop;

  return json({
    exports: (await loadLatestCompletedExports(shopDomain)).map((job: Job) => ({
      createdAt: job.createdAt.toISOString(),
      id: job.id,
      profile: (job.payload as { profile?: string } | null)?.profile ?? PRODUCT_CORE_SEO_EXPORT_PROFILE,
    })),
    preview: jobId ? await loadPreviewJobDetail({ jobId, shopDomain }) : null,
  });
}
