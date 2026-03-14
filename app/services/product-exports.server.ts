import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import { createPrismaJobQueue } from "~/domain/jobs/prisma-job-queue.mjs";
import {
  enqueueOrFindActiveProductExportJob,
} from "~/domain/products/export-jobs.mjs";
import {
  PRODUCT_EXPORT_FORMAT,
  PRODUCT_EXPORT_KIND,
  resolveProductExportProfile,
} from "~/domain/products/export-profile.mjs";

const jobQueue = createPrismaJobQueue(prisma);

export async function createProductExport({ request }: ActionFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const formData = await request.formData();
  const shopDomain = authContext.session.shop;
  const profile = resolveProductExportProfile(String(formData.get("profile") ?? ""));
  const job = await enqueueOrFindActiveProductExportJob({
    jobQueue,
    profile,
    prisma,
    shopDomain,
  });

  if (!job) {
    throw new Error("Failed to enqueue product export job");
  }

  return new Response(
    JSON.stringify({
      format: PRODUCT_EXPORT_FORMAT,
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
