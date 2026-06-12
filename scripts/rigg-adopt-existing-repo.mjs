#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DOC_CANDIDATES = [
  "AGENTS.md",
  "CODEX_START_PROMPT.md",
  "docs/template_scope.md",
  "docs/platform-truth-index.md",
  ".agent/PLANS.md",
  "tickets/README.md",
  "README.md",
  "docs/index.md",
  "docs/architecture.md",
];

function readJsonIfExists(relativePath) {
  if (!existsSync(relativePath)) return null;
  return JSON.parse(readFileSync(relativePath, "utf8"));
}

function detectPackageManager(packageJson) {
  const packageManager = packageJson?.packageManager;
  if (typeof packageManager === "string" && packageManager.startsWith("pnpm@")) {
    return "pnpm";
  }
  if (existsSync("pnpm-lock.yaml")) return "pnpm";
  return "npm";
}

function buildCommand(manager, scriptName) {
  if (manager === "pnpm") {
    return scriptName === "test" ? "pnpm test" : `pnpm run ${scriptName}`;
  }
  return scriptName === "test" ? "npm test" : `npm run ${scriptName}`;
}

function collectVerifyCommands(packageJson, manager) {
  const scripts = packageJson?.scripts ?? {};
  const commands = [];

  if (typeof scripts.check === "string") {
    return [manager === "pnpm" ? "pnpm check" : "npm run check"];
  }

  if (typeof scripts.lint === "string") commands.push(buildCommand(manager, "lint"));
  if (typeof scripts.typecheck === "string") commands.push(buildCommand(manager, "typecheck"));

  if (typeof scripts.test === "string") {
    commands.push(buildCommand(manager, "test"));
  } else if (typeof scripts["test:unit"] === "string") {
    commands.push(buildCommand(manager, "test:unit"));
  } else if (typeof scripts["test:contracts"] === "string") {
    commands.push(buildCommand(manager, "test:contracts"));
  }

  return commands;
}

function collectStandardsDocs() {
  const docs = DOC_CANDIDATES.filter((relativePath) => existsSync(relativePath));
  for (const workflowDir of [".github/workflows"]) {
    if (!existsSync(workflowDir)) continue;
    const workflowCandidates = ["ci.yml", "ci.yaml", "test.yml", "test.yaml"];
    for (const name of workflowCandidates) {
      const relativePath = path.join(workflowDir, name);
      if (existsSync(relativePath)) docs.push(relativePath);
    }
  }
  return docs;
}

function buildReviewScopeNote() {
  if (!existsSync("shopify.app.toml")) return "";
  return [
    "Shopify embedded app harness template. Default review scope is the current uncommitted diff, branch, or commit only.",
    "Do not add product-domain features, scopes, billing truth changes, webhook policy changes, or shop-specific webhooks unless an active ticket and ADR explicitly authorize them.",
    "For Shopify-specific validity, use official Shopify documentation as the source of truth.",
  ].join(" ");
}

function buildForbiddenChanges() {
  if (!existsSync("shopify.app.toml")) return [];
  return [
    "Do not change shopify.app.toml, access scopes, managed pricing or billing truth, webhook policy, or privacy/delete contracts unless the active ticket and ADR explicitly require it.",
    "Do not add Orders, Customers, or Discounts scopes by default.",
    "Do not introduce direct Admin API access, REST Admin API usage, off-platform billing, or shop-specific webhooks.",
    "Do not auto-commit.",
  ];
}

const packageJson = readJsonIfExists("package.json");
const manager = detectPackageManager(packageJson);
const profile = {
  schemaVersion: 1,
  displayName: packageJson?.name ?? path.basename(process.cwd()),
  mode: "cursor",
  standardsDocs: collectStandardsDocs(),
  verifyCommands: collectVerifyCommands(packageJson, manager),
  greenfieldDefault: false,
  reviewScopeNote: buildReviewScopeNote(),
  forbiddenChanges: buildForbiddenChanges(),
};

process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
