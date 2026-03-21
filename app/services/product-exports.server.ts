import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import { createArtifactStorageFromEnv } from "~/domain/artifacts/factory.mjs";
import { createPrismaJobQueue } from "~/domain/jobs/prisma-job-queue.mjs";
import {
  enqueueOrFindActiveProductExportJob,
} from "~/domain/products/export-jobs.mjs";
import {
  PRODUCT_EXPORT_KIND,
  PRODUCT_EXPORT_SOURCE_ARTIFACT_KIND,
  resolveProductExportFormat,
  resolveProductExportProfile,
} from "~/domain/products/export-profile.mjs";
import { getProductSpreadsheetContentType } from "~/domain/products/spreadsheet-format.mjs";

const artifactStorage: any = createArtifactStorageFromEnv();
const jobQueue = createPrismaJobQueue(prisma);

function extractArtifactBody(record: unknown) {
  if (Buffer.isBuffer(record)) {
    return record;
  }

  if (record && typeof record === "object" && "body" in record) {
    return record.body as Buffer;
  }

  return null;
}

export async function createProductExport({ request }: ActionFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const formData = await request.formData();
  const shopDomain = authContext.session.shop;
  const format = resolveProductExportFormat(String(formData.get("format") ?? ""));
  const profile = resolveProductExportProfile(String(formData.get("profile") ?? ""));
  const job = await enqueueOrFindActiveProductExportJob({
    format,
    jobQueue,
    profile,
    prisma,
    shopDomain,
  });

  if (!job) {
    throw new Error("商品エクスポートジョブの登録に失敗しました");
  }

  return new Response(
    JSON.stringify({
      format,
      jobId: job.id,
      kind: PRODUCT_EXPORT_KIND,
      profile,
      state: job.state,
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
      status: 202,
    },
  );
}

export async function loadProductExportDownload({ request }: LoaderFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const shopDomain = authContext.session.shop;

  if (!jobId) {
    return new Response(
      JSON.stringify({ error: "ダウンロードするエクスポートジョブを指定してください" }),
      { headers: { "Content-Type": "application/json" }, status: 400 },
    );
  }

  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      kind: PRODUCT_EXPORT_KIND,
      shopDomain,
      state: "completed",
    },
  });

  if (!job) {
    return new Response(
      JSON.stringify({ error: "指定されたエクスポートジョブは、このショップの完了済みエクスポートではありません" }),
      { headers: { "Content-Type": "application/json" }, status: 404 },
    );
  }

  const sourceArtifact = await prisma.artifact.findFirst({
    where: {
      deletedAt: null,
      jobId,
      kind: PRODUCT_EXPORT_SOURCE_ARTIFACT_KIND,
      shopDomain,
    },
  });

  if (!sourceArtifact) {
    return new Response(
      JSON.stringify({ error: "エクスポートファイルが見つかりません。保持期間が過ぎた可能性があります" }),
      { headers: { "Content-Type": "application/json" }, status: 404 },
    );
  }

  const record = await artifactStorage.get(sourceArtifact.objectKey);
  const body = extractArtifactBody(record);

  if (!body) {
    return new Response(
      JSON.stringify({ error: "エクスポートファイルを読み取れませんでした" }),
      { headers: { "Content-Type": "application/json" }, status: 500 },
    );
  }

  const payload = job.payload as { format?: string; profile?: string } | null;
  const format = payload?.format ?? "csv";
  const profile = payload?.profile ?? "product-core-seo-v1";
  const fileName = `${profile}-${jobId.slice(0, 8)}.${format === "xlsx" ? "xlsx" : "csv"}`;

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(body.byteLength),
      "Content-Type": getProductSpreadsheetContentType(format),
    },
  });
}
