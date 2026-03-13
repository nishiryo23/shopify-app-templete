import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  renderTaskDefinitionFile,
  renderTaskDefinitionTemplate,
} from "../../scripts/render-aws-task-definition.mjs";
import {
  buildWorkerId,
  JobFinalizeError,
  JobLeaseLostError,
  runBootstrapWorker,
  runJobWithLeaseHeartbeat,
  validateWorkerEnvironment,
  waitForShutdownOrTimeout,
} from "../../workers/bootstrap.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

const fixtureReplacements = Object.freeze({
  AWS_REGION: "ap-northeast-1",
  DATABASE_URL_SECRET_ARN: "arn:aws:secretsmanager:ap-northeast-1:123:secret:database",
  IMAGE_URI: "123.dkr.ecr.ap-northeast-1.amazonaws.com/shopify-matri:test",
  LOG_GROUP: "/ecs/shopify-matri",
  LOG_LEVEL: "info",
  PROVENANCE_SIGNING_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:ap-northeast-1:123:secret:provenance",
  QUEUE_LEASE_MS: "300000",
  QUEUE_POLL_INTERVAL_MS: "30000",
  S3_ARTIFACT_BUCKET: "matri-artifacts",
  S3_ARTIFACT_PREFIX: "artifacts",
  SCOPES: "read_products,write_products",
  SHOPIFY_API_KEY: "test-api-key",
  SHOPIFY_API_SECRET_ARN: "arn:aws:secretsmanager:ap-northeast-1:123:secret:shopify-api",
  SHOPIFY_APP_URL: "https://example.com",
  SHOP_TOKEN_ENCRYPTION_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:ap-northeast-1:123:secret:shop-token",
  TASK_EXECUTION_ROLE_ARN: "arn:aws:iam::123:role/ecsTaskExecution",
  TASK_ROLE_ARN: "arn:aws:iam::123:role/ecsTask",
  TASK_FAMILY: "shopify-matri-web",
});

test("aws bootstrap docs record required resources and existing service assumptions", () => {
  const readme = readProjectFile("infra/aws/README.md");

  assert.match(readme, /ECS service: `web`/);
  assert.match(readme, /ECS service: `worker`/);
  assert.match(readme, /service の作成を行わず/);
  assert.match(readme, /ALB target group は `web` のみを監視/);
  assert.match(readme, /health check path は `\/health`/);
  assert.match(readme, /private_subnet_ids/);
  assert.match(readme, /task_security_group_ids/);
  assert.match(readme, /ECS task definition の `secrets\.valueFrom` で注入/);
  assert.match(readme, /1\. Docker image build/);
  assert.match(readme, /4\. `migrate` one-off task run/);
});

test("deploy workflow includes migrate before web and worker updates", () => {
  const workflow = readProjectFile(".github/workflows/deploy.yml");

  assert.match(workflow, /private_subnet_ids:/);
  assert.match(workflow, /task_security_group_ids:/);
  assert.match(workflow, /Render task definitions/);
  assert.match(workflow, /Register and run migration task/);
  assert.match(workflow, /Update web service/);
  assert.match(workflow, /Update worker service/);
  assert.match(workflow, /--network-configuration/);
  assert.match(workflow, /run-task/);
  assert.match(workflow, /describe-tasks/);
  assert.match(workflow, /containers\[0\]\.exitCode/);
  assert.match(workflow, /stopCode/);
  assert.match(workflow, /Migration task failed: exitCode=/);
  assert.match(workflow, /wait services-stable/);
  assert.match(workflow, /npm install --global @shopify\/cli@latest/);
  assert.match(workflow, /shopify app deploy/);
  assert.match(workflow, /SHOPIFY_CLI_PARTNERS_TOKEN/);
  assert.match(workflow, /Missing required secret: SHOPIFY_CLI_PARTNERS_TOKEN/);
  assert.match(workflow, /Validate required Shopify app config/);
  assert.match(workflow, /Missing required workflow env:/);
  assert.match(workflow, /SHOPIFY_API_KEY SHOPIFY_APP_URL SCOPES/);
  assert.ok(
    workflow.indexOf("Register and run migration task") <
      workflow.indexOf("Update web service"),
  );
  assert.ok(
    workflow.indexOf("Update web service") <
      workflow.indexOf("Update worker service"),
  );
});

test("web template requires port mappings and secret valueFrom entries", () => {
  const template = readProjectFile("infra/aws/ecs/web.task-definition.json");

  assert.match(template, /"portMappings"/);
  assert.match(template, /"name": "PORT"/);
  assert.match(template, /"name": "DATABASE_URL", "valueFrom": "__DATABASE_URL_SECRET_ARN__"/);
  assert.match(
    template,
    /"name": "PROVENANCE_SIGNING_KEY",\s+"valueFrom": "__PROVENANCE_SIGNING_KEY_SECRET_ARN__"/,
  );
});

test("worker and migrate templates omit port mappings but keep shared secrets", () => {
  const workerTemplate = readProjectFile("infra/aws/ecs/worker.task-definition.json");
  const migrateTemplate = readProjectFile("infra/aws/ecs/migrate.task-definition.json");

  assert.doesNotMatch(workerTemplate, /"portMappings"/);
  assert.doesNotMatch(migrateTemplate, /"portMappings"/);
  assert.match(workerTemplate, /workers\/bootstrap\.mjs/);
  assert.match(migrateTemplate, /prisma:migrate:deploy/);
  assert.match(workerTemplate, /"name": "DATABASE_URL", "valueFrom": "__DATABASE_URL_SECRET_ARN__"/);
  assert.match(migrateTemplate, /"name": "DATABASE_URL", "valueFrom": "__DATABASE_URL_SECRET_ARN__"/);
});

test("render script fills placeholders and writes valid JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aws-task-render-"));
  const templatePath = path.join(rootDir, "infra/aws/ecs/web.task-definition.json");
  const outputPath = path.join(tempDir, "web.json");

  await renderTaskDefinitionFile({
    outputPath,
    replacements: fixtureReplacements,
    templatePath,
  });

  const rendered = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(rendered.family, fixtureReplacements.TASK_FAMILY);
  assert.equal(rendered.containerDefinitions[0].image, fixtureReplacements.IMAGE_URI);
  assert.equal(rendered.containerDefinitions[0].portMappings[0].containerPort, 3000);
  assert.equal(
    rendered.containerDefinitions[0].secrets.map((entry) => entry.name).join(","),
    "DATABASE_URL,SHOPIFY_API_SECRET,SHOP_TOKEN_ENCRYPTION_KEY,PROVENANCE_SIGNING_KEY",
  );
});

test("render script rejects unresolved placeholders", () => {
  assert.throws(
    () => renderTaskDefinitionTemplate('{"family":"__TASK_FAMILY__","image":"__IMAGE_URI__"}', {
      TASK_FAMILY: "family-only",
    }),
    /Missing replacements: IMAGE_URI/,
  );
});

test("health route responds with an unauthenticated 200 response", () => {
  const healthRoute = readProjectFile("app/routes/health.tsx");
  const healthService = readProjectFile("app/services/health.server.ts");

  assert.match(healthRoute, /loadHealthCheck/);
  assert.match(healthService, /new Response\("ok"/);
  assert.match(healthService, /status: 200/);
  assert.match(healthService, /Cache-Control/);
});

test("worker validation fails fast in production when required secrets are missing", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        LOG_LEVEL: "info",
        NODE_ENV: "production",
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "matri-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_APP_URL: "https://example.com",
      }),
    /Missing required worker secrets:/,
  );
});

test("worker validation fails fast outside production when provenance signing key is missing", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "matri-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_APP_URL: "https://example.com",
      }),
    /Missing required worker secrets: PROVENANCE_SIGNING_KEY/,
  );
});

test("worker validation fails fast outside production when Shopify API secret is missing", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
        PROVENANCE_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64"),
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "matri-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      }),
    /Missing required worker secrets: SHOPIFY_API_SECRET/,
  );
});

test("worker validation fails fast outside production when offline session encryption key is missing", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
        PROVENANCE_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64"),
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "matri-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
      }),
    /Missing required worker secrets: SHOP_TOKEN_ENCRYPTION_KEY/,
  );
});

test("worker validation fails fast when provenance signing key is not 32-byte base64", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
        PROVENANCE_SIGNING_KEY: "invalid",
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "matri-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      }),
    /PROVENANCE_SIGNING_KEY must decode to 32 bytes/,
  );
});

test("worker validation fails fast when shop token encryption key is not 32-byte base64", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
        PROVENANCE_SIGNING_KEY: Buffer.alloc(32, 9).toString("base64"),
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "matri-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: "invalid",
      }),
    /SHOP_TOKEN_ENCRYPTION_KEY must decode to 32 bytes/,
  );
});

test("worker validation accepts a fully configured production environment", () => {
  const config = validateWorkerEnvironment({
    AWS_REGION: "ap-northeast-1",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
    LOG_LEVEL: "info",
    NODE_ENV: "production",
    PROVENANCE_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64"),
    QUEUE_LEASE_MS: "300000",
    QUEUE_POLL_INTERVAL_MS: "30000",
    S3_ARTIFACT_BUCKET: "matri-artifacts",
    S3_ARTIFACT_PREFIX: "artifacts",
    SCOPES: "read_products,write_products",
    SHOPIFY_API_KEY: "test-api-key",
    SHOPIFY_API_SECRET: "secret",
    SHOPIFY_APP_URL: "https://example.com",
    SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
  });

  assert.equal(config.awsRegion, "ap-northeast-1");
  assert.equal(config.artifactPrefix, "artifacts");
  assert.equal(config.pollIntervalMs, 30000);
  assert.equal(config.queueLeaseMs, 300000);
});

test("worker validation rejects a one-millisecond lease that cannot heartbeat before expiry", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
        PROVENANCE_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64"),
        QUEUE_LEASE_MS: "1",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "matri-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      }),
    /QUEUE_LEASE_MS must be greater than 1/,
  );
});

test("worker id includes a per-process unique suffix instead of relying on pid only", () => {
  const workerIdA = buildWorkerId();
  const workerIdB = buildWorkerId();

  assert.match(workerIdA, /^worker:\d+:[0-9a-f-]{36}$/);
  assert.match(workerIdB, /^worker:\d+:[0-9a-f-]{36}$/);
  assert.notEqual(workerIdA, `worker:${process.pid}`);
  assert.notEqual(workerIdA, workerIdB);
});

test("worker sleep is interrupted immediately when shutdown is requested", async () => {
  let resolveShutdown;
  const shutdownPromise = new Promise((resolve) => {
    resolveShutdown = resolve;
  });
  const startedAt = Date.now();

  const resultPromise = waitForShutdownOrTimeout({
    milliseconds: 5000,
    shutdownPromise,
  });

  setTimeout(() => resolveShutdown("SIGTERM"), 10);

  const result = await resultPromise;
  assert.equal(result, "SIGTERM");
  assert.ok(Date.now() - startedAt < 1000);
});

test("worker heartbeats an in-flight leased job until the handler settles", async () => {
  const heartbeatCalls = [];

  await runJobWithLeaseHeartbeat({
    artifactStorage: {},
    heartbeatIntervalMs: 10,
    job: {
      id: "job-export-1",
    },
    jobQueue: {
      async heartbeat(args) {
        heartbeatCalls.push(args);
        return true;
      },
    },
    leaseMs: 30,
    logger: {
      error() {},
    },
    prisma: {},
    runJob: async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    },
    workerId: "worker-1",
  });

  assert.ok(heartbeatCalls.length >= 2);
  assert.deepEqual(
    heartbeatCalls.map((call) => [call.jobId, call.leaseMs, call.workerId]),
    heartbeatCalls.map(() => ["job-export-1", 30, "worker-1"]),
  );

  const heartbeatCountAfterCompletion = heartbeatCalls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(heartbeatCalls.length, heartbeatCountAfterCompletion);
});

test("worker heartbeat interval stays below low millisecond leases", async () => {
  const heartbeatCalls = [];

  await runJobWithLeaseHeartbeat({
    artifactStorage: {},
    job: {
      id: "job-export-1",
    },
    jobQueue: {
      async heartbeat(args) {
        heartbeatCalls.push(args);
        return true;
      },
    },
    leaseMs: 500,
    logger: {
      error() {},
    },
    prisma: {},
    runJob: async () => {
      await new Promise((resolve) => setTimeout(resolve, 340));
    },
    workerId: "worker-1",
  });

  assert.ok(heartbeatCalls.length >= 1);
  assert.deepEqual(
    heartbeatCalls.map((call) => [call.jobId, call.leaseMs, call.workerId]),
    heartbeatCalls.map(() => ["job-export-1", 500, "worker-1"]),
  );
});

test("worker heartbeat cadence does not drift by heartbeat round-trip time", async () => {
  const heartbeatCalls = [];
  let virtualNow = 0;

  await runJobWithLeaseHeartbeat({
    artifactStorage: {},
    heartbeatIntervalMs: 10,
    job: {
      id: "job-export-1",
    },
    jobQueue: {
      async heartbeat(args) {
        heartbeatCalls.push({ ...args, at: virtualNow });
        virtualNow += 9;
        return true;
      },
    },
    leaseMs: 30,
    logger: {
      error() {},
    },
    nowFn: () => virtualNow,
    prisma: {},
    runJob: async () => {
      while (heartbeatCalls.length < 3) {
        await Promise.resolve();
      }
    },
    sleep: async (milliseconds) => {
      virtualNow += milliseconds;
    },
    workerId: "worker-1",
  });

  assert.deepEqual(
    heartbeatCalls.map((call) => call.at),
    [10, 20, 30],
  );
});

test("worker keeps heartbeating through final state transition", async () => {
  const heartbeatCalls = [];
  let virtualNow = 0;
  let finalizeObservedAt = null;

  await runJobWithLeaseHeartbeat({
    artifactStorage: {},
    finalizeJob: async () => {
      while (heartbeatCalls.length < 3) {
        await Promise.resolve();
      }

      finalizeObservedAt = heartbeatCalls.at(-1)?.at ?? null;
    },
    heartbeatIntervalMs: 10,
    job: {
      id: "job-export-1",
    },
    jobQueue: {
      async heartbeat(args) {
        heartbeatCalls.push({ ...args, at: virtualNow });
        return true;
      },
    },
    leaseMs: 30,
    logger: {
      error() {},
    },
    nowFn: () => virtualNow,
    prisma: {},
    runJob: async () => {
      virtualNow += 5;
    },
    sleep: async (milliseconds) => {
      virtualNow += milliseconds;
      await Promise.resolve();
    },
    workerId: "worker-1",
  });

  assert.deepEqual(
    heartbeatCalls.map((call) => call.at),
    [15, 20, 30],
  );
  assert.equal(finalizeObservedAt, 30);
});

test("worker injects a lease fence so job code can stop side effects after heartbeat loss", async () => {
  const sideEffects = [];

  await assert.rejects(
    () => runJobWithLeaseHeartbeat({
      artifactStorage: {},
      heartbeatIntervalMs: 10,
      job: {
        id: "job-export-1",
      },
      jobQueue: {
        async heartbeat() {
          return false;
        },
      },
      leaseMs: 30,
      logger: {
        error() {},
      },
      prisma: {},
      runJob: async ({ assertJobLeaseActive }) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        assertJobLeaseActive();
        sideEffects.push("artifact-put");
      },
      workerId: "worker-1",
    }),
    (error) => error instanceof JobLeaseLostError,
  );

  assert.deepEqual(sideEffects, []);
});

test("worker keeps a successful export successful when an in-flight heartbeat fails during teardown", async () => {
  const loggerEvents = [];
  let releaseHeartbeat;

  await runJobWithLeaseHeartbeat({
    artifactStorage: {},
    heartbeatIntervalMs: 0,
    job: {
      id: "job-export-1",
    },
    jobQueue: {
      heartbeat() {
        return new Promise((_, reject) => {
          releaseHeartbeat = () => reject(new Error("transient-heartbeat-error"));
        });
      },
    },
    leaseMs: 30,
    logger: {
      error(message, payload) {
        loggerEvents.push([message, payload?.jobId, payload?.workerId]);
      },
    },
    prisma: {},
    runJob: async () => {
      while (!releaseHeartbeat) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      setTimeout(() => releaseHeartbeat(), 0);
    },
    sleep: async () => undefined,
    workerId: "worker-1",
  });

  assert.deepEqual(loggerEvents, [
    ["Worker lease heartbeat failed", "job-export-1", "worker-1"],
    ["Worker job finished after heartbeat failure", "job-export-1", "worker-1"],
  ]);
});

test("worker drains the active job before disconnecting prisma on shutdown", async () => {
  const events = [];
  const processRef = new EventEmitter();
  let resolveRunJob;
  let leaseAttempts = 0;

  const workerPromise = runBootstrapWorker({
    artifactStorage: {},
    env: {
      AWS_REGION: "ap-northeast-1",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
      PROVENANCE_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64"),
      QUEUE_LEASE_MS: "300000",
      QUEUE_POLL_INTERVAL_MS: "30000",
      S3_ARTIFACT_BUCKET: "matri-artifacts",
      S3_ARTIFACT_PREFIX: "artifacts",
      SCOPES: "read_products,write_products",
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "secret",
      SHOPIFY_APP_URL: "https://example.com",
      SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
    },
    jobQueue: {
      async complete() {
        events.push("complete");
        return true;
      },
      async fail() {
        events.push("fail");
        return { id: "job-export-1" };
      },
      async heartbeat() {
        return true;
      },
      async leaseNext() {
        leaseAttempts += 1;
        if (leaseAttempts === 1) {
          return {
            id: "job-export-1",
            shopDomain: "test-shop.myshopify.com",
          };
        }

        return null;
      },
    },
    logger: {
      error() {},
      info() {},
    },
    prisma: {
      async $connect() {
        events.push("connect");
      },
      async $disconnect() {
        events.push("disconnect");
      },
    },
    processRef,
    runJob: async () => {
      events.push("run-start");
      processRef.emit("SIGTERM");
      await new Promise((resolve) => {
        resolveRunJob = () => {
          events.push("run-end");
          resolve();
        };
      });
    },
    workerId: "worker-1",
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["connect", "run-start"]);

  resolveRunJob();
  await workerPromise;

  assert.deepEqual(events, ["connect", "run-start", "run-end", "complete", "disconnect"]);
  assert.equal(leaseAttempts, 1);
});

test("worker releases a newly leased job instead of starting it after shutdown is requested", async () => {
  const events = [];
  const processRef = new EventEmitter();
  let resolveLease;

  const workerPromise = runBootstrapWorker({
    artifactStorage: {},
    env: {
      AWS_REGION: "ap-northeast-1",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
      PROVENANCE_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64"),
      QUEUE_LEASE_MS: "300000",
      QUEUE_POLL_INTERVAL_MS: "30000",
      S3_ARTIFACT_BUCKET: "matri-artifacts",
      S3_ARTIFACT_PREFIX: "artifacts",
      SCOPES: "read_products,write_products",
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "secret",
      SHOPIFY_APP_URL: "https://example.com",
      SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
    },
    jobQueue: {
      async complete() {
        events.push("complete");
        return true;
      },
      async fail() {
        events.push("fail");
        return { id: "job-export-1" };
      },
      async heartbeat() {
        events.push("heartbeat");
        return true;
      },
      leaseNext() {
        events.push("lease-wait");
        return new Promise((resolve) => {
          resolveLease = () =>
            resolve({
              id: "job-export-1",
              shopDomain: "test-shop.myshopify.com",
            });
        });
      },
      async release({ jobId, workerId }) {
        events.push(`release:${jobId}:${workerId}`);
        return true;
      },
    },
    logger: {
      error() {},
      info() {},
    },
    prisma: {
      async $connect() {
        events.push("connect");
      },
      async $disconnect() {
        events.push("disconnect");
      },
    },
    processRef,
    runJob: async () => {
      events.push("run-start");
    },
    workerId: "worker-1",
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  processRef.emit("SIGTERM");
  resolveLease();
  await workerPromise;

  assert.deepEqual(events, ["connect", "lease-wait", "release:job-export-1:worker-1", "disconnect"]);
});

test("worker does not downgrade a successful export into fail() when complete() cannot finalize", async () => {
  const events = [];

  await assert.rejects(
    () => runBootstrapWorker({
      artifactStorage: {},
      env: {
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
        PROVENANCE_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64"),
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "matri-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      },
      jobQueue: {
        async complete() {
          events.push("complete");
          return false;
        },
        async fail() {
          events.push("fail");
          return { id: "job-export-1" };
        },
        async heartbeat() {
          return true;
        },
        async leaseNext() {
          if (events.includes("leased")) {
            return null;
          }

          events.push("leased");
          return {
            id: "job-export-1",
            shopDomain: "test-shop.myshopify.com",
          };
        },
      },
      logger: {
        error() {},
        info() {},
      },
      prisma: {
        async $connect() {
          events.push("connect");
        },
        async $disconnect() {
          events.push("disconnect");
        },
      },
      processRef: new EventEmitter(),
      runJob: async () => {
        events.push("run-success");
      },
      workerId: "worker-1",
    }),
    (error) => error instanceof JobFinalizeError,
  );

  assert.deepEqual(events, ["connect", "leased", "run-success", "complete", "disconnect"]);
});

test("dockerfile uses a multi-stage production build", () => {
  const dockerfile = readProjectFile("Dockerfile");
  const dockerignore = readProjectFile(".dockerignore");

  assert.match(dockerfile, /FROM node:22-bookworm-slim AS build/);
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS runtime/);
  assert.match(dockerfile, /pnpm run prisma:generate/);
  assert.match(dockerfile, /CMD \["pnpm", "start"\]/);
  assert.match(dockerignore, /^node_modules$/m);
  assert.match(dockerignore, /^\.pnpm-store$/m);
  assert.match(dockerignore, /^build$/m);
  assert.match(dockerignore, /^\.shopify$/m);
  assert.match(dockerignore, /^\.local-home$/m);
  assert.match(dockerignore, /^\.artifacts$/m);
});

test("development artifact storage uses a temp directory instead of the repository root", () => {
  const factory = readProjectFile("domain/artifacts/factory.mjs");

  assert.match(factory, /import os from "node:os"/);
  assert.match(factory, /path\.join\(os\.tmpdir\(\), "shopify-matri-artifacts"\)/);
  assert.doesNotMatch(factory, /process\.cwd\(\), "\.artifacts"/);
});

test("agents and promotion docs preserve aws bootstrap review invariants", () => {
  const agents = readProjectFile("AGENTS.md");
  const promotions = readProjectFile("docs/shopify-review-promotions.md");

  assert.match(agents, /deploy workflow は task render 前に必須 app config を fail-fast/);
  assert.match(agents, /optional な CI deploy path は clean runner 前提で成立させる/);
  assert.match(agents, /Docker build context には host 依存やローカル Shopify CLI state を混入させない/);

  assert.match(promotions, /AWS infra bootstrap に対する review/);
  assert.match(promotions, /migration task の `exitCode` と service rollout の `services-stable`/);
  assert.match(promotions, /SHOPIFY_CLI_PARTNERS_TOKEN/);
  assert.match(promotions, /host dependency と local Shopify CLI state/);
});
