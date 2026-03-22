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
  createPrismaJobQueue,
} from "../../domain/jobs/prisma-job-queue.mjs";
import { WEBHOOK_SHOP_REDACT_KIND } from "../../domain/webhooks/compliance-jobs.mjs";
import {
  buildWorkerId,
  cleanupCompletedRedactJob,
  enqueueDueSystemJobs,
  JobFinalizeError,
  JobLeaseLostError,
  runBootstrapWorker,
  runJobWithLeaseHeartbeat,
  validateWorkerEnvironment,
  waitForShutdownOrTimeout,
} from "../../workers/bootstrap.mjs";
import {
  SYSTEM_RETENTION_SWEEP_KIND,
  SYSTEM_STUCK_JOB_SWEEP_KIND,
  resolveSystemJobMaxAttempts,
} from "../../domain/system-jobs.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

const fixtureReplacements = Object.freeze({
  AWS_REGION: "ap-northeast-1",
  DATABASE_URL_SECRET_ARN: "arn:aws:secretsmanager:ap-northeast-1:123:secret:database",
  IMAGE_URI: "123.dkr.ecr.ap-northeast-1.amazonaws.com/shopify-app-template:test",
  LOG_GROUP: "/ecs/shopify-app-template",
  LOG_LEVEL: "info",
  QUEUE_LEASE_MS: "300000",
  QUEUE_POLL_INTERVAL_MS: "30000",
  S3_ARTIFACT_BUCKET: "template-artifacts",
  S3_ARTIFACT_PREFIX: "artifacts",
  SCOPES: "read_products,write_products",
  SHOPIFY_API_KEY: "test-api-key",
  SHOPIFY_API_SECRET_ARN: "arn:aws:secretsmanager:ap-northeast-1:123:secret:shopify-api",
  SHOPIFY_APP_URL: "https://example.com",
  TELEMETRY_PSEUDONYM_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:ap-northeast-1:123:secret:telemetry",
  SHOP_TOKEN_ENCRYPTION_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:ap-northeast-1:123:secret:shop-token",
  TASK_EXECUTION_ROLE_ARN: "arn:aws:iam::123:role/ecsTaskExecution",
  TASK_ROLE_ARN: "arn:aws:iam::123:role/ecsTask",
  TASK_FAMILY: "shopify-app-template-web",
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
  assert.match(readme, /observability-contract\.json/);
  assert.match(readme, /Asia\/Tokyo.*03:00|03:00.*Asia\/Tokyo/);
  assert.match(readme, /5 分ごと/);
  assert.match(readme, /shop backlog より先に lease/);
  assert.match(readme, /cooldown 後に同一 window を再試行/);
  assert.match(readme, /1\. Docker image build/);
  assert.match(readme, /4\. `migrate` one-off task run/);
});

test("deploy workflow includes migrate before web and worker updates", () => {
  const workflow = readProjectFile(".github/workflows/deploy.yml");

  assert.match(workflow, /private_subnet_ids:/);
  assert.match(workflow, /task_security_group_ids:/);
  assert.match(
    workflow,
    /run_shopify_deploy:\s+[\s\S]*default: "false"/m,
  );
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
  assert.match(workflow, /shopify app deploy --allow-updates/);
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
    /"name": "TELEMETRY_PSEUDONYM_KEY",\s+"valueFrom": "__TELEMETRY_PSEUDONYM_KEY_SECRET_ARN__"/,
  );
});

test("worker and migrate templates omit port mappings and keep telemetry secret out of migrate", () => {
  const workerTemplate = readProjectFile("infra/aws/ecs/worker.task-definition.json");
  const migrateTemplate = readProjectFile("infra/aws/ecs/migrate.task-definition.json");

  assert.doesNotMatch(workerTemplate, /"portMappings"/);
  assert.doesNotMatch(migrateTemplate, /"portMappings"/);
  assert.match(workerTemplate, /workers\/bootstrap\.mjs/);
  assert.match(migrateTemplate, /prisma:migrate:deploy/);
  assert.match(workerTemplate, /"name": "DATABASE_URL", "valueFrom": "__DATABASE_URL_SECRET_ARN__"/);
  assert.match(migrateTemplate, /"name": "DATABASE_URL", "valueFrom": "__DATABASE_URL_SECRET_ARN__"/);
  assert.match(workerTemplate, /"name": "TELEMETRY_PSEUDONYM_KEY"/);
  assert.doesNotMatch(migrateTemplate, /"name": "TELEMETRY_PSEUDONYM_KEY"/);
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
    "DATABASE_URL,SHOPIFY_API_SECRET,SHOP_TOKEN_ENCRYPTION_KEY,TELEMETRY_PSEUDONYM_KEY",
  );
});

test("observability contract fixes alarm metrics and scheduler cadence", () => {
  const contract = JSON.parse(readProjectFile("infra/aws/observability-contract.json"));

  assert.equal(contract.namespace, "ShopifyAppTemplate/Operations");
  assert.equal(contract.logRetentionDays, 7);
  assert.equal(contract.webhookPayloadRetentionDays, 7);
  assert.equal(contract.jobAttemptRetentionDays, 30);
  assert.deepEqual(contract.artifactRetentionDays, {});
  assert.deepEqual(contract.scheduler.retentionSweep, {
    deadLetterRetryCooldownMinutes: 30,
    dedupeKey: "system:retention-sweep:{JST calendar date}",
    kind: "system.retention-sweep",
    localTime: "03:00",
    timeZone: "Asia/Tokyo",
  });
  assert.deepEqual(contract.scheduler.stuckJobSweep, {
    cadenceMinutes: 5,
    deadLetterRetryCooldownMinutes: 5,
    dedupeKey: "system:stuck-job-sweep:{UTC 5-minute window start ISO}",
    kind: "system.stuck-job-sweep",
    timeZone: "UTC",
  });
  assert.deepEqual(contract.scheduler.fallbackDispatch, {
    prioritizeSystemJobs: true,
  });
  assert.equal(contract.alarms[0].metricName, "DeadLetteredJobs");
  assert.equal(contract.alarms[3].metricName, "StaleLeasedJobs");
  assert.equal(contract.alarms[3].statistic, "Maximum");
});

test("worker self-enqueues due system sweep jobs when no scheduler resource is provisioned", async () => {
  const prisma = {
    jobs: [],
    job: {
      async create({ data }) {
        const duplicate = prisma.jobs.find((job) =>
          job.shopDomain === data.shopDomain
          && job.kind === data.kind
          && job.dedupeKey === data.dedupeKey
          && data.dedupeKey !== null
          && job.state !== "dead_letter"
        );

        if (duplicate) {
          const error = new Error("duplicate");
          error.code = "P2002";
          throw error;
        }

        const created = {
          createdAt: new Date("2026-03-17T03:05:00.000Z"),
          id: `job-${prisma.jobs.length + 1}`,
          state: "queued",
          ...data,
        };
        prisma.jobs.push(created);
        return created;
      },
      async findFirst() {
        return null;
      },
    },
  };

  await enqueueDueSystemJobs({
    jobQueue: createPrismaJobQueue(prisma),
    logger: {
      info() {},
    },
    now: new Date("2026-03-16T18:05:00.000Z"),
  });

  assert.deepEqual(
    prisma.jobs.map((job) => job.kind).sort(),
    [SYSTEM_RETENTION_SWEEP_KIND, SYSTEM_STUCK_JOB_SWEEP_KIND],
  );
  assert.equal(
    prisma.jobs.find((job) => job.kind === SYSTEM_RETENTION_SWEEP_KIND)?.maxAttempts,
    resolveSystemJobMaxAttempts(SYSTEM_RETENTION_SWEEP_KIND),
  );
  assert.equal(
    prisma.jobs.find((job) => job.kind === SYSTEM_STUCK_JOB_SWEEP_KIND)?.maxAttempts,
    resolveSystemJobMaxAttempts(SYSTEM_STUCK_JOB_SWEEP_KIND),
  );
});

test("worker self-scheduler backfills missed retention sweep dates after downtime", async () => {
  const prisma = {
    jobs: [{
      createdAt: new Date("2026-03-16T03:05:00.000Z"),
      dedupeKey: "system:retention-sweep:2026-03-16",
      id: "job-retention-2026-03-16",
      kind: SYSTEM_RETENTION_SWEEP_KIND,
      payload: {},
      shopDomain: "__system__",
      state: "completed",
    }],
    job: {
      async create({ data }) {
        const created = { id: `job-${prisma.jobs.length + 1}`, state: "queued", ...data };
        prisma.jobs.push(created);
        return created;
      },
      async findFirst({ where }) {
        if (where.dedupeKey == null) {
          return [...prisma.jobs]
            .filter((job) => job.shopDomain === where.shopDomain && job.kind === where.kind)
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
        }

        return prisma.jobs.find((job) =>
          job.shopDomain === where.shopDomain
          && job.kind === where.kind
          && job.dedupeKey === where.dedupeKey,
        ) ?? null;
      },
    },
  };

  await enqueueDueSystemJobs({
    jobQueue: createPrismaJobQueue(prisma),
    logger: {
      info() {},
    },
    now: new Date("2026-03-18T01:00:00.000Z"),
  });

  assert.deepEqual(
    prisma.jobs
      .filter((job) => job.kind === SYSTEM_RETENTION_SWEEP_KIND)
      .map((job) => job.dedupeKey)
      .sort(),
    [
      "system:retention-sweep:2026-03-16",
      "system:retention-sweep:2026-03-17",
      "system:retention-sweep:2026-03-18",
    ],
  );
});

test("worker self-scheduler backfills the missed prior-day retention window before 03:00 JST", async () => {
  const prisma = {
    jobs: [{
      createdAt: new Date("2026-03-16T03:05:00.000Z"),
      dedupeKey: "system:retention-sweep:2026-03-16",
      id: "job-retention-2026-03-16",
      kind: SYSTEM_RETENTION_SWEEP_KIND,
      payload: {},
      shopDomain: "__system__",
      state: "completed",
    }],
    job: {
      async create({ data }) {
        const created = { id: `job-${prisma.jobs.length + 1}`, state: "queued", ...data };
        prisma.jobs.push(created);
        return created;
      },
      async findFirst({ where }) {
        if (where.dedupeKey == null) {
          return [...prisma.jobs]
            .filter((job) => job.shopDomain === where.shopDomain && job.kind === where.kind)
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
        }

        return prisma.jobs.find((job) =>
          job.shopDomain === where.shopDomain
          && job.kind === where.kind
          && job.dedupeKey === where.dedupeKey,
        ) ?? null;
      },
    },
  };

  await enqueueDueSystemJobs({
    jobQueue: createPrismaJobQueue(prisma),
    logger: {
      info() {},
    },
    now: new Date("2026-03-17T15:30:00.000Z"),
  });

  assert.deepEqual(
    prisma.jobs
      .filter((job) => job.kind === SYSTEM_RETENTION_SWEEP_KIND)
      .map((job) => job.dedupeKey)
      .sort(),
    [
      "system:retention-sweep:2026-03-16",
      "system:retention-sweep:2026-03-17",
    ],
  );
});

test("worker self-scheduler backfills the prior-day retention window on a fresh queue before 03:00 JST", async () => {
  const prisma = {
    jobs: [],
    job: {
      async create({ data }) {
        const created = { id: `job-${prisma.jobs.length + 1}`, state: "queued", ...data };
        prisma.jobs.push(created);
        return created;
      },
      async findFirst() {
        return null;
      },
      async findMany() {
        return [];
      },
    },
  };

  await enqueueDueSystemJobs({
    jobQueue: createPrismaJobQueue(prisma),
    logger: {
      info() {},
    },
    now: new Date("2026-03-17T15:30:00.000Z"),
  });

  assert.deepEqual(
    prisma.jobs
      .filter((job) => job.kind === SYSTEM_RETENTION_SWEEP_KIND)
      .map((job) => job.dedupeKey),
    ["system:retention-sweep:2026-03-17"],
  );
});

test("manual system job script uses the shared retry contract for each kind", () => {
  const script = readProjectFile("scripts/enqueue-system-job.mjs");

  assert.match(
    script,
    /maxAttempts: resolveSystemJobMaxAttempts\(SYSTEM_RETENTION_SWEEP_KIND\)/,
  );
  assert.match(
    script,
    /maxAttempts: resolveSystemJobMaxAttempts\(SYSTEM_STUCK_JOB_SWEEP_KIND\)/,
  );
  assert.match(
    script,
    /maxAttempts: jobConfig\.maxAttempts/,
  );
});

test("worker self-scheduler does not enqueue the same system window twice after completion", async () => {
  const prisma = {
    jobs: [{
      createdAt: new Date("2026-03-17T03:05:00.000Z"),
      dedupeKey: "system:stuck-job-sweep:2026-03-17T03:05:00.000Z",
      id: "job-existing",
      kind: SYSTEM_STUCK_JOB_SWEEP_KIND,
      payload: {},
      shopDomain: "__system__",
      state: "completed",
    }],
    job: {
      async create({ data }) {
        const duplicate = prisma.jobs.find((job) =>
          job.shopDomain === data.shopDomain
          && job.kind === data.kind
          && job.dedupeKey === data.dedupeKey
          && data.dedupeKey !== null
          && job.state !== "dead_letter"
        );

        if (duplicate) {
          const error = new Error("duplicate");
          error.code = "P2002";
          throw error;
        }

        const created = { id: "job-new", state: "queued", ...data };
        prisma.jobs.push(created);
        return created;
      },
      async findFirst({ where }) {
        if (where.dedupeKey == null) {
          return prisma.jobs.find((job) =>
            job.shopDomain === where.shopDomain
            && job.kind === where.kind,
          ) ?? null;
        }

        return prisma.jobs.find((job) =>
          job.shopDomain === where.shopDomain
          && job.kind === where.kind
          && job.dedupeKey === where.dedupeKey,
        ) ?? null;
      },
    },
  };

  await enqueueDueSystemJobs({
    jobQueue: createPrismaJobQueue(prisma),
    logger: {
      info() {},
    },
    now: new Date("2026-03-17T03:07:00.000Z"),
  });

  assert.equal(prisma.jobs.some((job) => job.kind === SYSTEM_STUCK_JOB_SWEEP_KIND && job.id !== "job-existing"), false);
  assert.equal(prisma.jobs.some((job) => job.kind === SYSTEM_RETENTION_SWEEP_KIND), true);
});

test("worker self-scheduler retries a dead-lettered stuck-job sweep window after cooldown", async () => {
  const prisma = {
    jobs: [{
      createdAt: new Date("2026-03-17T03:05:00.000Z"),
      deadLetteredAt: new Date("2026-03-17T03:06:00.000Z"),
      dedupeKey: "system:stuck-job-sweep:2026-03-17T03:05:00.000Z",
      id: "job-dead-lettered",
      kind: SYSTEM_STUCK_JOB_SWEEP_KIND,
      payload: {},
      shopDomain: "__system__",
      state: "dead_letter",
    }],
    job: {
      async create({ data }) {
        const duplicate = prisma.jobs.find((job) =>
          job.shopDomain === data.shopDomain
          && job.kind === data.kind
          && job.dedupeKey === data.dedupeKey
          && data.dedupeKey !== null
          && job.state !== "dead_letter"
        );

        if (duplicate) {
          const error = new Error("duplicate");
          error.code = "P2002";
          throw error;
        }

        const created = { id: "job-retry", state: "queued", ...data };
        prisma.jobs.push(created);
        return created;
      },
      async findFirst({ where }) {
        if (where.dedupeKey == null) {
          return prisma.jobs.find((job) =>
            job.shopDomain === where.shopDomain
            && job.kind === where.kind,
          ) ?? null;
        }

        return prisma.jobs.find((job) =>
          job.shopDomain === where.shopDomain
          && job.kind === where.kind
          && job.dedupeKey === where.dedupeKey,
        ) ?? null;
      },
    },
  };

  await enqueueDueSystemJobs({
    jobQueue: createPrismaJobQueue(prisma),
    logger: {
      info() {},
    },
    now: new Date("2026-03-17T03:12:00.000Z"),
  });

  assert.equal(
    prisma.jobs.some((job) => job.kind === SYSTEM_STUCK_JOB_SWEEP_KIND && job.id === "job-retry"),
    true,
  );
});

test("worker self-scheduler defers a dead-lettered daily retention sweep until cooldown expires", async () => {
  const prisma = {
    jobs: [{
      createdAt: new Date("2026-03-17T03:00:00.000Z"),
      deadLetteredAt: new Date("2026-03-17T03:10:00.000Z"),
      dedupeKey: "system:retention-sweep:2026-03-17",
      id: "job-dead-lettered-retention",
      kind: SYSTEM_RETENTION_SWEEP_KIND,
      payload: {},
      shopDomain: "__system__",
      state: "dead_letter",
    }],
    job: {
      async create({ data }) {
        const created = { id: "job-should-not-exist", state: "queued", ...data };
        prisma.jobs.push(created);
        return created;
      },
      async findFirst({ where }) {
        if (where.dedupeKey == null) {
          return prisma.jobs.find((job) =>
            job.shopDomain === where.shopDomain
            && job.kind === where.kind,
          ) ?? null;
        }

        return prisma.jobs.find((job) =>
          job.shopDomain === where.shopDomain
          && job.kind === where.kind
          && job.dedupeKey === where.dedupeKey,
        ) ?? null;
      },
    },
  };

  await enqueueDueSystemJobs({
    jobQueue: createPrismaJobQueue(prisma),
    logger: {
      info() {},
    },
    now: new Date("2026-03-17T03:25:00.000Z"),
  });

  assert.equal(
    prisma.jobs.some((job) => job.kind === SYSTEM_RETENTION_SWEEP_KIND && job.id === "job-should-not-exist"),
    false,
  );
});

test("worker self-scheduler retries a dead-lettered daily retention sweep after cooldown", async () => {
  const prisma = {
    jobs: [{
      createdAt: new Date("2026-03-17T03:00:00.000Z"),
      deadLetteredAt: new Date("2026-03-17T03:10:00.000Z"),
      dedupeKey: "system:retention-sweep:2026-03-17",
      id: "job-dead-lettered-retention",
      kind: SYSTEM_RETENTION_SWEEP_KIND,
      payload: {},
      shopDomain: "__system__",
      state: "dead_letter",
    }],
    job: {
      async create({ data }) {
        const created = { id: "job-retention-retry", state: "queued", ...data };
        prisma.jobs.push(created);
        return created;
      },
      async findFirst({ where }) {
        if (where.dedupeKey == null) {
          return prisma.jobs.find((job) =>
            job.shopDomain === where.shopDomain
            && job.kind === where.kind,
          ) ?? null;
        }

        return prisma.jobs.find((job) =>
          job.shopDomain === where.shopDomain
          && job.kind === where.kind
          && job.dedupeKey === where.dedupeKey,
        ) ?? null;
      },
    },
  };

  await enqueueDueSystemJobs({
    jobQueue: createPrismaJobQueue(prisma),
    logger: {
      info() {},
    },
    now: new Date("2026-03-17T03:45:00.000Z"),
  });

  assert.equal(
    prisma.jobs.some((job) => job.kind === SYSTEM_RETENTION_SWEEP_KIND && job.id === "job-retention-retry"),
    true,
  );
});

test("worker self-scheduler retries an older dead-lettered retention window even after later windows completed", async () => {
  const prisma = {
    jobs: [{
      createdAt: new Date("2026-03-17T03:00:00.000Z"),
      deadLetteredAt: new Date("2026-03-17T03:10:00.000Z"),
      dedupeKey: "system:retention-sweep:2026-03-17",
      id: "job-dead-lettered-retention",
      kind: SYSTEM_RETENTION_SWEEP_KIND,
      payload: {},
      shopDomain: "__system__",
      state: "dead_letter",
    }, {
      createdAt: new Date("2026-03-18T03:00:00.000Z"),
      dedupeKey: "system:retention-sweep:2026-03-18",
      id: "job-completed-retention",
      kind: SYSTEM_RETENTION_SWEEP_KIND,
      payload: {},
      shopDomain: "__system__",
      state: "completed",
    }],
    job: {
      async create({ data }) {
        const duplicate = prisma.jobs.find((job) =>
          job.shopDomain === data.shopDomain
          && job.kind === data.kind
          && job.dedupeKey === data.dedupeKey
          && data.dedupeKey !== null
          && job.state !== "dead_letter"
        );

        if (duplicate) {
          const error = new Error("duplicate");
          error.code = "P2002";
          throw error;
        }

        const created = { id: `job-${prisma.jobs.length + 1}`, state: "queued", ...data };
        prisma.jobs.push(created);
        return created;
      },
      async findFirst({ where }) {
        if (where.dedupeKey == null) {
          return [...prisma.jobs]
            .filter((job) => job.shopDomain === where.shopDomain && job.kind === where.kind)
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
        }

        return [...prisma.jobs]
          .filter((job) =>
            job.shopDomain === where.shopDomain
            && job.kind === where.kind
            && job.dedupeKey === where.dedupeKey,
          )
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
      },
      async findMany({ where }) {
        return [...prisma.jobs]
          .filter((job) => job.shopDomain === where.shopDomain && job.kind === where.kind)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      },
    },
  };

  await enqueueDueSystemJobs({
    jobQueue: createPrismaJobQueue(prisma),
    logger: {
      info() {},
    },
    now: new Date("2026-03-18T01:00:00.000Z"),
  });

  assert.equal(
    prisma.jobs.some((job) =>
      job.kind === SYSTEM_RETENTION_SWEEP_KIND
      && job.dedupeKey === "system:retention-sweep:2026-03-17"
      && job.id !== "job-dead-lettered-retention",
    ),
    true,
  );
});

test("worker prioritizes due system sweep jobs ahead of ordinary backlog", async () => {
  const leasedKinds = [];
  const processRef = new EventEmitter();

  await runBootstrapWorker({
    artifactStorage: {},
    env: {
      AWS_REGION: "ap-northeast-1",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
      QUEUE_LEASE_MS: "300000",
      QUEUE_POLL_INTERVAL_MS: "30000",
      S3_ARTIFACT_BUCKET: "template-artifacts",
      S3_ARTIFACT_PREFIX: "artifacts",
      SCOPES: "read_products,write_products",
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "secret",
      SHOPIFY_APP_URL: "https://example.com",
      SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
    },
    jobQueue: {
      async complete() {
        return true;
      },
      async fail() {
        return null;
      },
      async heartbeat() {
        return true;
      },
      async leaseNext({ kinds }) {
        leasedKinds.push(kinds);
        if (kinds?.includes(SYSTEM_RETENTION_SWEEP_KIND)) {
          return {
            id: "system-job-1",
            kind: SYSTEM_RETENTION_SWEEP_KIND,
            payload: {},
            shopDomain: "__system__",
          };
        }

        throw new Error("ordinary backlog should not be leased while a due system job exists");
      },
    },
    logger: {
      error() {},
      info() {},
    },
    prisma: {
      async $connect() {},
      async $disconnect() {},
    },
    processRef,
    runJob: async () => {
      processRef.emit("SIGTERM");
    },
    workerId: "worker-1",
  });

  assert.deepEqual(leasedKinds, [[SYSTEM_RETENTION_SWEEP_KIND, SYSTEM_STUCK_JOB_SWEEP_KIND]]);
});

test("bootstrap cleanup removes finalized shop redact queue state after completion", async () => {
  const deleted = [];

  const result = await cleanupCompletedRedactJob({
    jobId: "job-redact-active",
    logger: {
      info() {},
    },
    prisma: {
      async $transaction(callback) {
        return callback({
          job: {
            async deleteMany(args) {
              deleted.push(["job", args]);
              return { count: 1 };
            },
          },
          jobLease: {
            async deleteMany(args) {
              deleted.push(["jobLease", args]);
              return { count: 1 };
            },
          },
        });
      },
    },
    shopDomain: "example.myshopify.com",
  });

  assert.deepEqual(result, {
    deletedJobLeases: 1,
    deletedJobs: 1,
  });
  assert.deepEqual(deleted, [
    ["job", { where: {
      id: "job-redact-active",
      shopDomain: "example.myshopify.com",
    } }],
    ["jobLease", { where: {
      jobId: null,
      leaseToken: null,
      shopDomain: "example.myshopify.com",
      workerId: null,
    } }],
  ]);
});

test("bootstrap worker emits the retention failure counter when the sweep job fails", async () => {
  const lines = [];
  const processRef = new EventEmitter();
  let leased = false;

  await runBootstrapWorker({
    artifactStorage: {},
    env: {
      AWS_REGION: "ap-northeast-1",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
      NODE_ENV: "production",
      QUEUE_LEASE_MS: "300000",
      QUEUE_POLL_INTERVAL_MS: "30000",
      S3_ARTIFACT_BUCKET: "template-artifacts",
      S3_ARTIFACT_PREFIX: "artifacts",
      SCOPES: "read_products,write_products",
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "secret",
      SHOPIFY_APP_URL: "https://example.com",
      SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
    },
    jobQueue: {
      async complete() {
        return true;
      },
      async enqueue() {
        return null;
      },
      async fail() {
        processRef.emit("SIGTERM");
        return { id: "system-retention-1", state: "retryable" };
      },
      async findLatestByDedupeKey() {
        return null;
      },
      async heartbeat() {
        return true;
      },
      async leaseNext() {
        if (leased) {
          return null;
        }

        leased = true;
        return {
          id: "system-retention-1",
          kind: SYSTEM_RETENTION_SWEEP_KIND,
          payload: {},
          shopDomain: "__system__",
        };
      },
    },
    logger: {
      error() {},
      info() {},
      log(line) {
        lines.push(JSON.parse(line));
      },
    },
    prisma: {
      async $connect() {},
      async $disconnect() {},
    },
    processRef,
    runJob: async () => {
      const error = new Error("retention-sweep-retry-needed");
      error.code = "retention-sweep-retry-needed";
      throw error;
    },
    workerId: "worker-1",
  });

  assert.equal(lines.some((line) => line.RetentionSweepFailures === 1), true);
  assert.equal(lines.some((line) => line.event === "system.retention_sweep.failed"), true);
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
        S3_ARTIFACT_BUCKET: "template-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_APP_URL: "https://example.com",
      }),
    /Missing required worker secrets:/,
  );
});

test("worker validation fails fast outside production when Shopify API secret is missing", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "template-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
        TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
      }),
    /Missing required worker secrets: SHOPIFY_API_SECRET/,
  );
});

test("worker validation fails fast outside production when offline session encryption key is missing", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "template-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
        TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
      }),
    /Missing required worker secrets: SHOP_TOKEN_ENCRYPTION_KEY/,
  );
});

test("worker validation fails fast when telemetry pseudonym key is missing", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
        NODE_ENV: "production",
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "template-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      }),
    /Missing required worker secrets: TELEMETRY_PSEUDONYM_KEY/,
  );
});

test("worker validation allows telemetry pseudonym key to be omitted outside production", () => {
  const config = validateWorkerEnvironment({
    AWS_REGION: "ap-northeast-1",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
    QUEUE_LEASE_MS: "300000",
    QUEUE_POLL_INTERVAL_MS: "30000",
    S3_ARTIFACT_BUCKET: "template-artifacts",
    S3_ARTIFACT_PREFIX: "artifacts",
    SCOPES: "read_products,write_products",
    SHOPIFY_API_KEY: "test-api-key",
    SHOPIFY_API_SECRET: "secret",
    SHOPIFY_APP_URL: "https://example.com",
    SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
  });

  assert.equal(config.awsRegion, "ap-northeast-1");
});

test("worker validation fails fast when shop token encryption key is not 32-byte base64", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "template-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: "invalid",
        TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 8).toString("base64"),
      }),
    /SHOP_TOKEN_ENCRYPTION_KEY must decode to 32 bytes/,
  );
});

test("worker validation accepts a fully configured production environment", () => {
  const config = validateWorkerEnvironment({
    AWS_REGION: "ap-northeast-1",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
    LOG_LEVEL: "info",
    NODE_ENV: "production",
    QUEUE_LEASE_MS: "300000",
    QUEUE_POLL_INTERVAL_MS: "30000",
    S3_ARTIFACT_BUCKET: "template-artifacts",
    S3_ARTIFACT_PREFIX: "artifacts",
    SCOPES: "read_products,write_products",
    SHOPIFY_API_KEY: "test-api-key",
    SHOPIFY_API_SECRET: "secret",
    SHOPIFY_APP_URL: "https://example.com",
    SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
    TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
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
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
        QUEUE_LEASE_MS: "1",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "template-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
        TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
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
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
      QUEUE_LEASE_MS: "300000",
      QUEUE_POLL_INTERVAL_MS: "30000",
      S3_ARTIFACT_BUCKET: "template-artifacts",
      S3_ARTIFACT_PREFIX: "artifacts",
      SCOPES: "read_products,write_products",
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "secret",
      SHOPIFY_APP_URL: "https://example.com",
      SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
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
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
      QUEUE_LEASE_MS: "300000",
      QUEUE_POLL_INTERVAL_MS: "30000",
      S3_ARTIFACT_BUCKET: "template-artifacts",
      S3_ARTIFACT_PREFIX: "artifacts",
      SCOPES: "read_products,write_products",
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "secret",
      SHOPIFY_APP_URL: "https://example.com",
      SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
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

test("worker passes configured queueLeaseMs to system stuck-job sweep handlers", async () => {
  const seenArgs = [];
  const processRef = new EventEmitter();
  let leased = false;

  await runBootstrapWorker({
    artifactStorage: {},
    env: {
      AWS_REGION: "ap-northeast-1",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
      QUEUE_LEASE_MS: "420000",
      QUEUE_POLL_INTERVAL_MS: "30000",
      S3_ARTIFACT_BUCKET: "template-artifacts",
      S3_ARTIFACT_PREFIX: "artifacts",
      SCOPES: "read_products,write_products",
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "secret",
      SHOPIFY_APP_URL: "https://example.com",
      SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
    },
    jobQueue: {
      async complete() {
        return true;
      },
      async fail() {
        return { id: "system-job-1" };
      },
      async heartbeat() {
        return true;
      },
      async leaseNext() {
        if (leased) {
          return null;
        }

        leased = true;
        return {
          id: "system-job-1",
          kind: SYSTEM_STUCK_JOB_SWEEP_KIND,
          payload: {},
          shopDomain: "__system__",
        };
      },
    },
    logger: {
      error() {},
      info() {},
    },
    prisma: {
      async $connect() {},
      async $disconnect() {},
    },
    processRef,
    runJob: async (args) => {
      seenArgs.push({
        leaseMs: args.leaseMs,
        queueLeaseMs: args.queueLeaseMs,
      });
      processRef.emit("SIGTERM");
    },
    workerId: "worker-1",
  });

  assert.deepEqual(seenArgs, [{
    leaseMs: 420000,
    queueLeaseMs: 420000,
  }]);
});

test("worker keeps draining ordinary jobs when scheduled system job enqueue fails", async () => {
  const events = [];
  const processRef = new EventEmitter();
  let enqueueAttempts = 0;
  let leased = false;

  await runBootstrapWorker({
    artifactStorage: {},
    env: {
      AWS_REGION: "ap-northeast-1",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
      QUEUE_LEASE_MS: "300000",
      QUEUE_POLL_INTERVAL_MS: "30000",
      S3_ARTIFACT_BUCKET: "template-artifacts",
      S3_ARTIFACT_PREFIX: "artifacts",
      SCOPES: "read_products,write_products",
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "secret",
      SHOPIFY_APP_URL: "https://example.com",
      SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
    },
    jobQueue: {
      async complete() {
        events.push("complete");
        return true;
      },
      async enqueue() {
        enqueueAttempts += 1;
        if (enqueueAttempts === 1) {
          throw new Error("transient-enqueue-failure");
        }
        return null;
      },
      async fail() {
        events.push("fail");
        return null;
      },
      async heartbeat() {
        return true;
      },
      async leaseNext() {
        if (leased) {
          return null;
        }

        leased = true;
        return {
          id: "job-export-1",
          kind: WEBHOOK_SHOP_REDACT_KIND,
          payload: {},
          shopDomain: "test-shop.myshopify.com",
        };
      },
    },
    logger: {
      error(message, payload) {
        events.push(["error", message, payload?.error?.message, payload?.workerId]);
      },
      info(message) {
        events.push(["info", message]);
      },
      log(line) {
        events.push(["log", line]);
      },
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
      events.push("run-job");
      processRef.emit("SIGTERM");
    },
    workerId: "worker-1",
  });

  assert.equal(enqueueAttempts >= 1, true);
  assert.equal(events.includes("run-job"), true);
  assert.equal(events.includes("complete"), true);
  assert.deepEqual(events.find((event) => Array.isArray(event) && event[0] === "error"), [
    "error",
    "Bootstrap worker failed to enqueue scheduled system jobs",
    "transient-enqueue-failure",
    "worker-1",
  ]);
});

test("worker does not downgrade a successful export into fail() when complete() cannot finalize", async () => {
  const events = [];

  await assert.rejects(
    () => runBootstrapWorker({
      artifactStorage: {},
      env: {
        AWS_REGION: "ap-northeast-1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/template",
        QUEUE_LEASE_MS: "300000",
        QUEUE_POLL_INTERVAL_MS: "30000",
        S3_ARTIFACT_BUCKET: "template-artifacts",
        S3_ARTIFACT_PREFIX: "artifacts",
        SCOPES: "read_products,write_products",
        SHOPIFY_API_KEY: "test-api-key",
        SHOPIFY_API_SECRET: "secret",
        SHOPIFY_APP_URL: "https://example.com",
        SHOP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
        TELEMETRY_PSEUDONYM_KEY: Buffer.alloc(32, 3).toString("base64"),
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
  assert.match(factory, /path\.join\(os\.tmpdir\(\), "shopify-app-template-artifacts"\)/);
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
