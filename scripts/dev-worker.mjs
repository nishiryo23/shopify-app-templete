import process from "node:process";
import { pathToFileURL } from "node:url";

import { applyShopifyDevAppUrl } from "./shopify-dev-app-url.mjs";
import { runBootstrapWorker } from "../workers/bootstrap.mjs";

const LOCAL_WORKER_DEFAULTS = Object.freeze({
  AWS_REGION: "ap-northeast-1",
  QUEUE_LEASE_MS: "30000",
  QUEUE_POLL_INTERVAL_MS: "1000",
  S3_ARTIFACT_BUCKET: "local-artifacts",
  S3_ARTIFACT_PREFIX: "dev",
});

export function applyLocalWorkerDefaults(env = process.env) {
  for (const [key, value] of Object.entries(LOCAL_WORKER_DEFAULTS)) {
    if (!env[key]) {
      env[key] = value;
    }
  }

  return applyShopifyDevAppUrl(env);
}

export function assertLocalWorkerEnvironment(env = process.env) {
  const resolvedAppUrl = applyLocalWorkerDefaults(env);

  if (resolvedAppUrl) {
    return resolvedAppUrl;
  }

  throw new Error(
    "Local worker requires SHOPIFY_APP_URL. Run via `shopify app dev` or set HOST/APP_URL/SHOPIFY_APP_URL to the current tunnel URL.",
  );
}

function isDirectExecution() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

if (isDirectExecution()) {
  assertLocalWorkerEnvironment();
  runBootstrapWorker({ env: process.env }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
