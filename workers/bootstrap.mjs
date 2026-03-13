import { PrismaClient } from "@prisma/client";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REQUIRED_WORKER_SECRETS = Object.freeze([
  "DATABASE_URL",
  "SHOPIFY_API_SECRET",
  "SHOP_TOKEN_ENCRYPTION_KEY",
  "PROVENANCE_SIGNING_KEY",
]);

const REQUIRED_WORKER_CONFIG = Object.freeze([
  "AWS_REGION",
  "QUEUE_POLL_INTERVAL_MS",
  "QUEUE_LEASE_MS",
  "SHOPIFY_API_KEY",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "S3_ARTIFACT_BUCKET",
  "S3_ARTIFACT_PREFIX",
]);

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function validateWorkerEnvironment(env = process.env) {
  const missingConfig = REQUIRED_WORKER_CONFIG.filter((name) => !env[name]);
  if (missingConfig.length > 0) {
    throw new Error(`Missing required worker env vars: ${missingConfig.join(", ")}`);
  }

  if (env.NODE_ENV === "production") {
    const missingSecrets = REQUIRED_WORKER_SECRETS.filter((name) => !env[name]);
    if (missingSecrets.length > 0) {
      throw new Error(`Missing required worker secrets: ${missingSecrets.join(", ")}`);
    }
  }

  return {
    awsRegion: env.AWS_REGION,
    logLevel: env.LOG_LEVEL || "info",
    pollIntervalMs: parsePositiveInt(env.QUEUE_POLL_INTERVAL_MS, "QUEUE_POLL_INTERVAL_MS"),
    queueLeaseMs: parsePositiveInt(env.QUEUE_LEASE_MS, "QUEUE_LEASE_MS"),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function waitForShutdownOrTimeout({
  milliseconds,
  shutdownPromise,
  sleep = delay,
}) {
  return Promise.race([sleep(milliseconds), shutdownPromise]);
}

export async function runBootstrapWorker({
  env = process.env,
  logger = console,
} = {}) {
  const config = validateWorkerEnvironment(env);
  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info?.(`Bootstrap worker connected to PostgreSQL in ${config.awsRegion}`);

  let stopping = false;
  let signalShutdown = () => {};
  const shutdownPromise = new Promise((resolve) => {
    signalShutdown = resolve;
  });

  const shutdown = async (signal) => {
    if (stopping) {
      return;
    }

    stopping = true;
    signalShutdown(signal);
    logger.info?.(`Bootstrap worker received ${signal}; disconnecting`);
    await prisma.$disconnect();
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  while (!stopping) {
    logger.info?.(
      `Bootstrap worker idle tick leaseMs=${config.queueLeaseMs} pollMs=${config.pollIntervalMs}`,
    );
    await waitForShutdownOrTimeout({
      milliseconds: config.pollIntervalMs,
      shutdownPromise,
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runBootstrapWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
