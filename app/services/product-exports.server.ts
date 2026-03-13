import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticateAndBootstrapShop } from "./auth-bootstrap.server";
import { createPrismaJobQueue } from "~/domain/jobs/prisma-job-queue.mjs";
import {
  enqueueOrFindActiveProductExportJob,
} from "~/domain/products/export-jobs.mjs";
import {
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_EXPORT_FORMAT,
  PRODUCT_EXPORT_KIND,
} from "~/domain/products/export-profile.mjs";

const jobQueue = createPrismaJobQueue(prisma);

export async function createProductExport({ request }: ActionFunctionArgs) {
  const authContext = await authenticateAndBootstrapShop(request);
  const shopDomain = authContext.session.shop;
  const job = await enqueueOrFindActiveProductExportJob({
    jobQueue,
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
      profile: PRODUCT_CORE_SEO_EXPORT_PROFILE,
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
