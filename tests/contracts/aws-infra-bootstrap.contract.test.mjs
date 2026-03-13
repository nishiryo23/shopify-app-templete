import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  renderTaskDefinitionFile,
  renderTaskDefinitionTemplate,
} from "../../scripts/render-aws-task-definition.mjs";
import {
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

test("worker validation accepts a fully configured production environment", () => {
  const config = validateWorkerEnvironment({
    AWS_REGION: "ap-northeast-1",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/matri",
    LOG_LEVEL: "info",
    NODE_ENV: "production",
    PROVENANCE_SIGNING_KEY: "key",
    QUEUE_LEASE_MS: "300000",
    QUEUE_POLL_INTERVAL_MS: "30000",
    S3_ARTIFACT_BUCKET: "matri-artifacts",
    S3_ARTIFACT_PREFIX: "artifacts",
    SCOPES: "read_products,write_products",
    SHOPIFY_API_KEY: "test-api-key",
    SHOPIFY_API_SECRET: "secret",
    SHOPIFY_APP_URL: "https://example.com",
    SHOP_TOKEN_ENCRYPTION_KEY: "encryption-key",
  });

  assert.equal(config.awsRegion, "ap-northeast-1");
  assert.equal(config.pollIntervalMs, 30000);
  assert.equal(config.queueLeaseMs, 300000);
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
});
