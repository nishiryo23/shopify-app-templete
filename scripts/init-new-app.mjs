import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { constants as fsConstants } from "node:fs";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ZERO_CLIENT_ID_PATTERN = /client_id\s*=\s*"0{32}"/;
const EXAMPLE_APP_URL_PATTERN = /(?:application_url\s*=\s*"https:\/\/example\.com"|redirect_urls\s*=\s*\[[^\]]*https:\/\/example\.com)/s;
const UNCONFIGURED = "UNCONFIGURED_BEFORE_SUBMISSION";
const DEFAULT_DATABASE_URL =
  "postgresql://127.0.0.1:5432/shopify_app_template_dev?schema=public";
const CANONICAL_TEMPLATE_REPOSITORIES = new Set(["nishiryo23/shopify-app-templete"]);

const INPUT_SPECS = Object.freeze([
  {
    key: "appName",
    flag: "app-name",
    env: "INIT_APP_NAME",
    label: "App name",
    required: true,
  },
  {
    key: "appHandle",
    flag: "app-handle",
    aliases: ["handle"],
    env: "SHOPIFY_APP_HANDLE",
    fallbackEnv: "INIT_APP_HANDLE",
    label: "Shopify app handle",
    required: true,
  },
  {
    key: "appUrl",
    flag: "production-url",
    aliases: ["app-url"],
    env: "SHOPIFY_APP_URL",
    fallbackEnv: "INIT_APP_URL",
    label: "Production app URL",
    required: true,
  },
  {
    key: "databaseUrl",
    flag: "database-url",
    env: "DATABASE_URL",
    fallbackEnv: "INIT_DATABASE_URL",
    label: "Local DATABASE_URL",
    defaultValue: DEFAULT_DATABASE_URL,
  },
  {
    key: "supportEmail",
    flag: "support-email",
    env: "SHOPIFY_SUPPORT_EMAIL",
    fallbackEnv: "INIT_SUPPORT_EMAIL",
    label: "Support email",
    required: true,
  },
  {
    key: "submissionContactEmail",
    flag: "submission-contact-email",
    env: "SHOPIFY_SUBMISSION_CONTACT_EMAIL",
    fallbackEnv: "INIT_SUBMISSION_CONTACT_EMAIL",
    label: "Submission contact email",
  },
  {
    key: "privacyPolicyUrl",
    flag: "privacy-policy-url",
    env: "SHOPIFY_PRIVACY_POLICY_URL",
    fallbackEnv: "INIT_PRIVACY_POLICY_URL",
    label: "Privacy policy URL",
    required: true,
  },
  {
    key: "reviewerDevStore",
    flag: "reviewer-dev-store",
    env: "SHOPIFY_REVIEWER_DEV_STORE",
    fallbackEnv: "INIT_REVIEWER_DEV_STORE",
    label: "Reviewer / dev store",
    required: true,
  },
  {
    key: "dryRunDate",
    flag: "dry-run-date",
    env: "SHOPIFY_REVIEW_DRY_RUN_DATE",
    fallbackEnv: "INIT_DRY_RUN_DATE",
    label: "Dry-run date",
  },
  {
    key: "verifiedBy",
    flag: "verified-by",
    env: "SHOPIFY_REVIEW_VERIFIED_BY",
    fallbackEnv: "INIT_VERIFIED_BY",
    label: "Verified by",
  },
  {
    key: "shopTokenEncryptionKey",
    flag: "shop-token-encryption-key",
    env: "SHOP_TOKEN_ENCRYPTION_KEY",
    fallbackEnv: "INIT_SHOP_TOKEN_ENCRYPTION_KEY",
    label: "SHOP_TOKEN_ENCRYPTION_KEY",
  },
]);

function usage() {
  return `Prerequisite:
  shopify app config link

Usage:
  node scripts/init-new-app.mjs --confirm-fork
  node scripts/init-new-app.mjs --non-interactive \\
    --confirm-fork \\
    --app-name "My App" \\
    --app-handle my-app \\
    --production-url https://app.example.com \\
    --support-email support@example.com \\
    --privacy-policy-url https://app.example.com/privacy \\
    --reviewer-dev-store reviewer-store.myshopify.com

Flags:
  --app-name, --app-handle, --production-url
  --database-url
  --support-email, --submission-contact-email, --privacy-policy-url
  --reviewer-dev-store, --dry-run-date, --verified-by
  --shop-token-encryption-key
  --confirm-fork
  --rotate-shop-token-key
  --non-interactive
  --skip-checks
  --help

Safety:
  Run production shopify app config link before this script. Shopify CLI link creates or
  overwrites config files, so running it after this script can discard initialized URLs.
  Existing SHOP_TOKEN_ENCRYPTION_KEY values are preserved unless --rotate-shop-token-key
  is passed.

Environment alternatives:
  INIT_APP_NAME, SHOPIFY_APP_HANDLE, SHOPIFY_APP_URL,
  DATABASE_URL, SHOP_TOKEN_ENCRYPTION_KEY,
  SHOPIFY_SUPPORT_EMAIL, SHOPIFY_SUBMISSION_CONTACT_EMAIL,
  SHOPIFY_PRIVACY_POLICY_URL, SHOPIFY_REVIEWER_DEV_STORE,
  SHOPIFY_REVIEW_DRY_RUN_DATE, SHOPIFY_REVIEW_VERIFIED_BY`;
}

export function parseArgs(argv) {
  const values = {};
  const options = {
    help: false,
    confirmFork: false,
    nonInteractive: false,
    runChecks: true,
    rotateShopTokenKey: false,
  };

  const flagToKey = new Map();
  for (const spec of INPUT_SPECS) {
    flagToKey.set(spec.flag, spec.key);
    for (const alias of spec.aliases ?? []) {
      flagToKey.set(alias, spec.key);
    }
  }

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];

    if (raw === "--help" || raw === "-h") {
      options.help = true;
      continue;
    }

    if (raw === "--non-interactive") {
      options.nonInteractive = true;
      continue;
    }

    if (raw === "--confirm-fork") {
      options.confirmFork = true;
      continue;
    }

    if (raw === "--rotate-shop-token-key") {
      options.rotateShopTokenKey = true;
      continue;
    }

    if (raw === "--skip-checks") {
      options.runChecks = false;
      continue;
    }

    if (!raw.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${raw}`);
    }

    const withoutPrefix = raw.slice(2);
    const equalIndex = withoutPrefix.indexOf("=");
    const flag = equalIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, equalIndex);
    const inlineValue = equalIndex === -1 ? null : withoutPrefix.slice(equalIndex + 1);
    const key = flagToKey.get(flag);

    if (!key) {
      throw new Error(`Unknown flag: --${flag}`);
    }

    if (inlineValue !== null) {
      values[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${flag}`);
    }

    values[key] = next;
    index += 1;
  }

  return { options, values };
}

function envValue(env, spec) {
  return env[spec.env] ?? (spec.fallbackEnv ? env[spec.fallbackEnv] : undefined);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function trimValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function promptForMissingValues(values, options, env) {
  const resolved = { ...values };

  for (const spec of INPUT_SPECS) {
    if (resolved[spec.key] === undefined) {
      const fromEnv = envValue(env, spec);
      if (fromEnv !== undefined) {
        resolved[spec.key] = fromEnv;
      }
    }
  }

  if (!resolved.submissionContactEmail && resolved.supportEmail) {
    resolved.submissionContactEmail = resolved.supportEmail;
  }

  if (!resolved.dryRunDate) {
    resolved.dryRunDate = todayIsoDate();
  }

  if (!resolved.verifiedBy && resolved.submissionContactEmail) {
    resolved.verifiedBy = resolved.submissionContactEmail;
  }

  const missingRequired = INPUT_SPECS.filter((spec) => spec.required && !trimValue(resolved[spec.key]));
  const canPrompt = process.stdin.isTTY && process.stdout.isTTY && !options.nonInteractive;

  if (missingRequired.length > 0 && !canPrompt) {
    throw new Error(
      `Missing required init values: ${missingRequired
        .map((spec) => spec.key)
        .join(", ")}. Pass flags/env vars or run in an interactive terminal.`,
    );
  }

  if (!canPrompt) {
    return resolved;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    for (const spec of INPUT_SPECS) {
      if (spec.key === "shopTokenEncryptionKey") {
        continue;
      }

      const current = trimValue(resolved[spec.key]);
      if (current) {
        continue;
      }

      const fallback =
        spec.key === "submissionContactEmail"
          ? trimValue(resolved.supportEmail)
          : spec.key === "dryRunDate"
            ? todayIsoDate()
            : spec.key === "verifiedBy"
              ? trimValue(resolved.submissionContactEmail)
              : spec.defaultValue;
      const suffix = fallback ? ` [${fallback}]` : "";
      const answer = await rl.question(`${spec.label}${suffix}: `);
      resolved[spec.key] = trimValue(answer) || fallback || "";
    }
  } finally {
    rl.close();
  }

  if (!resolved.submissionContactEmail && resolved.supportEmail) {
    resolved.submissionContactEmail = resolved.supportEmail;
  }

  if (!resolved.dryRunDate) {
    resolved.dryRunDate = todayIsoDate();
  }

  if (!resolved.verifiedBy && resolved.submissionContactEmail) {
    resolved.verifiedBy = resolved.submissionContactEmail;
  }

  return resolved;
}

export async function resolveInputs(values = {}, options = {}, env = process.env) {
  const resolved = await promptForMissingValues(values, options, env);
  const normalized = {
    appName: trimValue(resolved.appName),
    appHandle: trimValue(resolved.appHandle),
    appUrl: normalizeHttpsUrl(resolved.appUrl, {
      label: "Production app URL",
      originOnly: true,
    }),
    databaseUrl: trimValue(resolved.databaseUrl) || DEFAULT_DATABASE_URL,
    supportEmail: trimValue(resolved.supportEmail),
    submissionContactEmail: trimValue(resolved.submissionContactEmail) || trimValue(resolved.supportEmail),
    privacyPolicyUrl: normalizeHttpsUrl(resolved.privacyPolicyUrl, {
      label: "Privacy policy URL",
    }),
    reviewerDevStore: trimValue(resolved.reviewerDevStore),
    dryRunDate: trimValue(resolved.dryRunDate) || todayIsoDate(),
    verifiedBy: trimValue(resolved.verifiedBy) || trimValue(resolved.submissionContactEmail) || trimValue(resolved.supportEmail),
    shopTokenEncryptionKey: trimValue(resolved.shopTokenEncryptionKey),
  };

  validateInputs(normalized);
  return normalized;
}

function normalizeHttpsUrl(rawValue, { label = "URL", originOnly = false } = {}) {
  const value = trimValue(rawValue);
  if (!value) {
    return "";
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${label} must use https: ${value}`);
  }

  if (url.username || url.password) {
    throw new Error(`${label} must not include username or password.`);
  }

  if (originOnly && (url.pathname !== "/" || url.search || url.hash)) {
    throw new Error(`${label} must be an origin-only URL without path, query, or hash.`);
  }

  if (originOnly) {
    return url.origin;
  }

  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function validateInputs(input) {
  const missing = Object.entries({
    appName: input.appName,
    appHandle: input.appHandle,
    appUrl: input.appUrl,
    supportEmail: input.supportEmail,
    submissionContactEmail: input.submissionContactEmail,
    privacyPolicyUrl: input.privacyPolicyUrl,
    reviewerDevStore: input.reviewerDevStore,
    dryRunDate: input.dryRunDate,
    verifiedBy: input.verifiedBy,
  })
    .filter(([, value]) => !trimValue(value))
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required init values: ${missing.join(", ")}`);
  }

  if (new URL(input.appUrl).hostname.toLowerCase() === "example.com") {
    throw new Error("Production app URL must not use example.com.");
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(input.appHandle)) {
    throw new Error("Shopify app handle must be lowercase letters, numbers, and hyphens.");
  }

  for (const [name, value] of [
    ["supportEmail", input.supportEmail],
    ["submissionContactEmail", input.submissionContactEmail],
  ]) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new Error(`${name} must be an email address.`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dryRunDate)) {
    throw new Error("dryRunDate must use YYYY-MM-DD.");
  }
}

function escapeTomlString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function replaceTomlString(source, key, value) {
  const pattern = new RegExp(`^${key}\\s*=\\s*"[^"]*"`, "m");
  if (!pattern.test(source)) {
    throw new Error(`shopify.app.toml is missing ${key}.`);
  }
  return source.replace(pattern, () => `${key} = "${escapeTomlString(value)}"`);
}

function getAuthRedirectUrls(source) {
  const match = source.match(/\[auth\]\s*redirect_urls\s*=\s*\[([\s\S]*?)\]/m);
  if (!match) {
    throw new Error("shopify.app.toml is missing auth.redirect_urls.");
  }

  const urls = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  if (urls.length === 0) {
    throw new Error("shopify.app.toml auth.redirect_urls must contain at least one URL.");
  }

  return urls;
}

function redirectPathFromUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function updateShopifyAppTomlSource(source, input) {
  const redirectPaths = [...new Set(getAuthRedirectUrls(source).map(redirectPathFromUrl))];
  const redirectUrls = redirectPaths.map((redirectPath) => `${input.appUrl}${redirectPath}`);
  const authBlock = `[auth]
redirect_urls = [ ${redirectUrls.map((url) => `"${escapeTomlString(url)}"`).join(", ")} ]`;

  return replaceTomlString(replaceTomlString(source, "name", input.appName), "application_url", input.appUrl)
    .replace(/\[auth\]\s*redirect_urls\s*=\s*\[[\s\S]*?\]/m, () => authBlock);
}

export function createDevelopmentTomlSource(productionSource, input) {
  return replaceTomlString(productionSource, "name", `${input.appName} Development`);
}

function setEnvValue(source, key, value) {
  const quoted = JSON.stringify(value);
  const activePattern = new RegExp(`^${key}=.*$`, "m");
  const commentedPattern = new RegExp(`^#\\s*${key}=.*$`, "m");

  if (activePattern.test(source)) {
    return source.replace(activePattern, () => `${key}=${quoted}`);
  }

  if (commentedPattern.test(source)) {
    return source.replace(commentedPattern, () => `${key}=${quoted}`);
  }

  return `${source.replace(/\s*$/, "\n")}${key}=${quoted}\n`;
}

function getEnvValue(source, key) {
  const match = source.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) {
    return "";
  }

  const rawValue = match[1].trim();
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      throw new Error(`${key} must use a valid JSON-style quoted value: ${error.message}`);
    }
  }

  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }

  return rawValue;
}

export function updateEnvSource(source, input) {
  return [
    ["DATABASE_URL", input.databaseUrl],
    ["SHOP_TOKEN_ENCRYPTION_KEY", input.shopTokenEncryptionKey],
    ["SHOPIFY_APP_HANDLE", input.appHandle],
  ].reduce((current, [key, value]) => setEnvValue(current, key, value), source);
}

function replaceMarkdownTableValue(source, field, value) {
  const pattern = new RegExp(`(\\|\\s*${field}\\s*\\|\\s*)\`[^\\n\`]*\`(\\s*\\|)`, "m");
  if (!pattern.test(source)) {
    throw new Error(`docs/app-review-metadata.md is missing ${field}.`);
  }

  return source.replace(pattern, (_match, prefix, suffix) => `${prefix}\`${value}\`${suffix}`);
}

export function updateAppReviewMetadataSource(source, input) {
  return [
    ["Support email", input.supportEmail],
    ["Submission contact email", input.submissionContactEmail],
    ["Privacy policy URL", input.privacyPolicyUrl],
  ].reduce((current, [field, value]) => replaceMarkdownTableValue(current, field, value), source);
}

function replaceReviewerSnapshotValue(source, field, value) {
  const pattern = new RegExp(`(- ${field}: )\`[^\\n\`]*\``, "m");
  if (!pattern.test(source)) {
    throw new Error(`docs/reviewer-packet.md is missing ${field}.`);
  }

  return source.replace(pattern, (_match, prefix) => `${prefix}\`${value}\``);
}

export function updateReviewerPacketSource(source, input) {
  return [
    ["Support email", input.supportEmail],
    ["Submission contact email", input.submissionContactEmail],
    ["Privacy policy URL", input.privacyPolicyUrl],
    ["Reviewer / dev store", input.reviewerDevStore],
    ["Dry-run date", input.dryRunDate],
    ["Verified by", input.verifiedBy],
  ].reduce((current, [field, value]) => replaceReviewerSnapshotValue(current, field, value), source);
}

function decodeBase64ByteLength(value) {
  return Buffer.from(value, "base64").byteLength;
}

function isValidShopTokenEncryptionKey(value) {
  return trimValue(value) && decodeBase64ByteLength(value) === 32;
}

function assertValidShopTokenEncryptionKey(value, message) {
  if (!isValidShopTokenEncryptionKey(value)) {
    throw new Error(message);
  }
}

export function findResidualPlaceholders(files) {
  const violations = [];

  for (const [relativePath, source] of Object.entries(files)) {
    if (/^shopify\.app(?:\.development)?\.toml$/.test(relativePath)) {
      if (ZERO_CLIENT_ID_PATTERN.test(source)) {
        violations.push({
          file: relativePath,
          message: 'client_id still uses the template placeholder. Run `shopify app config link`.',
        });
      }

      if (EXAMPLE_APP_URL_PATTERN.test(source)) {
        violations.push({
          file: relativePath,
          message: "application_url or auth.redirect_urls still use https://example.com.",
        });
      }
    }

    if (relativePath === ".env") {
      const handleMatch = source.match(/^SHOPIFY_APP_HANDLE=(.*)$/m);
      if (!handleMatch || !trimValue(handleMatch[1]).replace(/^"|"$/g, "")) {
        violations.push({
          file: relativePath,
          message: "SHOPIFY_APP_HANDLE is missing.",
        });
      }

      const keyMatch = source.match(/^SHOP_TOKEN_ENCRYPTION_KEY=(.*)$/m);
      const key = keyMatch?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
      if (!key || decodeBase64ByteLength(key) !== 32) {
        violations.push({
          file: relativePath,
          message: "SHOP_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte secret.",
        });
      }
    }

    if (relativePath === "docs/app-review-metadata.md") {
      for (const field of ["Support email", "Submission contact email", "Privacy policy URL"]) {
        const pattern = new RegExp(`\\|\\s*${field}\\s*\\|\\s*\`${UNCONFIGURED}\``);
        if (pattern.test(source)) {
          violations.push({
            file: relativePath,
            message: `${field} still uses ${UNCONFIGURED}.`,
          });
        }
      }
    }

    if (relativePath === "docs/reviewer-packet.md") {
      for (const field of [
        "Support email",
        "Submission contact email",
        "Privacy policy URL",
        "Reviewer / dev store",
        "Dry-run date",
        "Verified by",
      ]) {
        const pattern = new RegExp(`- ${field}: \`${UNCONFIGURED}\``);
        if (pattern.test(source)) {
          violations.push({
            file: relativePath,
            message: `${field} still uses ${UNCONFIGURED}.`,
          });
        }
      }
    }
  }

  return violations;
}

export function assertNoResidualPlaceholders(files) {
  const violations = findResidualPlaceholders(files);
  if (violations.length === 0) {
    return;
  }

  const details = violations.map((violation) => `- ${violation.file}: ${violation.message}`).join("\n");
  throw new Error(`Fork initialization placeholders remain:\n${details}`);
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readProjectFile(rootDir, relativePath) {
  return readFile(path.join(rootDir, relativePath), "utf8");
}

async function removeIfExists(filePath, rmImpl) {
  await rmImpl(filePath, { force: true });
}

async function restoreCommittedWrites(records, { renameImpl, rmImpl }) {
  const rollbackErrors = [];

  for (const record of [...records].reverse()) {
    try {
      if (record.installed) {
        await removeIfExists(record.finalPath, rmImpl);
      }

      if (record.backedUp) {
        await renameImpl(record.backupPath, record.finalPath);
      }
    } catch (error) {
      rollbackErrors.push(error);
    }
  }

  if (rollbackErrors.length > 0) {
    throw new AggregateError(rollbackErrors, "Rollback failed after fork initialization write failure.");
  }
}

export async function writeProjectFilesAtomically(
  rootDir,
  files,
  {
    writeFileImpl = writeFile,
    renameImpl = rename,
    rmImpl = rm,
  } = {},
) {
  const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const records = Object.keys(files).map((relativePath, index) => {
    const finalPath = path.join(rootDir, relativePath);
    const directory = path.dirname(finalPath);
    const basename = path.basename(finalPath);
    return {
      relativePath,
      source: files[relativePath],
      finalPath,
      tempPath: path.join(directory, `.${basename}.${nonce}.${index}.tmp`),
      backupPath: path.join(directory, `.${basename}.${nonce}.${index}.bak`),
      backedUp: false,
      installed: false,
    };
  });

  let allFilesInstalled = false;

  try {
    for (const record of records) {
      await writeFileImpl(record.tempPath, record.source, "utf8");
    }

    for (const record of records) {
      if (await fileExists(record.finalPath)) {
        await renameImpl(record.finalPath, record.backupPath);
        record.backedUp = true;
      }

      await renameImpl(record.tempPath, record.finalPath);
      record.installed = true;
    }

    allFilesInstalled = true;
    const backupCleanupErrors = [];
    for (const record of records) {
      if (record.backedUp) {
        try {
          await removeIfExists(record.backupPath, rmImpl);
        } catch (cleanupError) {
          backupCleanupErrors.push(cleanupError);
        }
      }
    }

    if (backupCleanupErrors.length > 0) {
      throw new AggregateError(
        backupCleanupErrors,
        "Fork initialization files were written, but backup cleanup failed.",
      );
    }
  } catch (error) {
    if (allFilesInstalled) {
      throw error;
    }

    const cleanupErrors = [];
    for (const record of records) {
      try {
        await removeIfExists(record.tempPath, rmImpl);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }

    try {
      await restoreCommittedWrites(records, { renameImpl, rmImpl });
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Fork initialization write failed and rollback failed.");
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], "Fork initialization write failed and temp cleanup failed.");
    }

    throw error;
  }
}

export async function generateShopTokenEncryptionKey() {
  const key = randomBytes(32).toString("base64");
  if (decodeBase64ByteLength(key) !== 32) {
    throw new Error("node:crypto generated an invalid SHOP_TOKEN_ENCRYPTION_KEY.");
  }
  return key;
}

async function readOptionalFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return null;
    }
    throw error;
  }
}

async function readGitConfig(rootDir) {
  const directConfig = await readOptionalFile(path.join(rootDir, ".git", "config"));
  if (directConfig !== null) {
    return directConfig;
  }

  const dotGitFile = await readOptionalFile(path.join(rootDir, ".git"));
  const gitDirMatch = dotGitFile?.match(/^gitdir:\s*(.+)$/m);
  if (!gitDirMatch) {
    return null;
  }

  const gitDir = path.isAbsolute(gitDirMatch[1])
    ? gitDirMatch[1]
    : path.resolve(rootDir, gitDirMatch[1]);
  return readOptionalFile(path.join(gitDir, "config"));
}

function normalizeGithubRepository(remoteUrl) {
  const value = remoteUrl.trim().replace(/\.git$/i, "");
  const match = value.match(/github\.com[:/]([^/\s]+\/[^/\s]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function gitRemoteUrlsByName(gitConfig) {
  const remotes = new Map();
  let currentRemote = null;

  for (const line of gitConfig.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[remote\s+"([^"]+)"\]\s*$/);
    if (sectionMatch) {
      currentRemote = sectionMatch[1];
      if (!remotes.has(currentRemote)) {
        remotes.set(currentRemote, []);
      }
      continue;
    }

    if (/^\s*\[/.test(line)) {
      currentRemote = null;
      continue;
    }

    const urlMatch = line.match(/^\s*url\s*=\s*(.+)$/);
    if (currentRemote && urlMatch) {
      remotes.get(currentRemote).push(urlMatch[1].trim());
    }
  }

  return remotes;
}

export async function detectCanonicalTemplateCheckout(rootDir) {
  const gitConfig = await readGitConfig(rootDir);
  if (!gitConfig) {
    return null;
  }

  const originUrls = gitRemoteUrlsByName(gitConfig).get("origin") ?? [];
  for (const remoteUrl of originUrls) {
    const repository = normalizeGithubRepository(remoteUrl);
    if (repository && CANONICAL_TEMPLATE_REPOSITORIES.has(repository)) {
      return remoteUrl;
    }
  }

  return null;
}

function assertProductionConfigLinked(productionToml) {
  const clientIdMatch = productionToml.match(/^client_id\s*=\s*"([^"]+)"/m);
  if (!clientIdMatch || ZERO_CLIENT_ID_PATTERN.test(productionToml)) {
    throw new Error(
      [
        "shopify.app.toml is not linked to a Shopify app.",
        "Run `shopify app config link` before `node scripts/init-new-app.mjs --confirm-fork`.",
        "Shopify CLI config link creates or overwrites config files, so linking after this script can discard initialized URLs.",
      ].join(" "),
    );
  }
}

export async function assertForkInitializationPreflight({
  rootDir,
  productionToml,
  confirmedFork = false,
} = {}) {
  if (!confirmedFork) {
    throw new Error(
      [
        "Fork initialization requires --confirm-fork.",
        "Run this only in a fork after `shopify app config link` has linked production config.",
      ].join(" "),
    );
  }

  const canonicalRemote = await detectCanonicalTemplateCheckout(rootDir);
  if (canonicalRemote) {
    throw new Error(
      `Refusing to initialize the canonical template checkout (${canonicalRemote}). Run this script only in a fork.`,
    );
  }

  assertProductionConfigLinked(productionToml);
}

async function resolveShopTokenEncryptionKey({
  envSource,
  generatedKey,
  requestedKey,
  rotateShopTokenKey,
}) {
  const existingKey = getEnvValue(envSource, "SHOP_TOKEN_ENCRYPTION_KEY");
  const requested = trimValue(requestedKey);

  if (existingKey) {
    assertValidShopTokenEncryptionKey(
      existingKey,
      "Existing SHOP_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte secret.",
    );

    if (!rotateShopTokenKey) {
      if (requested && requested !== existingKey) {
        throw new Error(
          "Refusing to overwrite existing SHOP_TOKEN_ENCRYPTION_KEY without --rotate-shop-token-key.",
        );
      }
      return existingKey;
    }
  }

  const key = requested || generatedKey || (await generateShopTokenEncryptionKey());
  assertValidShopTokenEncryptionKey(
    key,
    "SHOP_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte secret.",
  );
  return key;
}

async function loadEnvSource(rootDir) {
  const envPath = path.join(rootDir, ".env");
  if (await fileExists(envPath)) {
    return readFile(envPath, "utf8");
  }

  return readProjectFile(rootDir, ".env.example");
}

export async function initializeNewApp({
  rootDir = process.cwd(),
  confirmedFork = false,
  input,
  runChecks = true,
  generatedKey,
  rotateShopTokenKey = false,
  writeFileImpl = writeFile,
  renameImpl = rename,
  rmImpl = rm,
} = {}) {
  if (!input) {
    throw new Error("initializeNewApp requires input.");
  }

  const productionToml = await readProjectFile(rootDir, "shopify.app.toml");
  await assertForkInitializationPreflight({
    rootDir,
    productionToml,
    confirmedFork,
  });
  const envSource = await loadEnvSource(rootDir);
  const shopTokenEncryptionKey =
    await resolveShopTokenEncryptionKey({
      envSource,
      generatedKey,
      requestedKey: input.shopTokenEncryptionKey,
      rotateShopTokenKey,
    });
  const resolvedInput = {
    ...input,
    shopTokenEncryptionKey,
  };

  validateInputs(resolvedInput);

  const metadataSource = await readProjectFile(rootDir, "docs/app-review-metadata.md");
  const reviewerPacketSource = await readProjectFile(rootDir, "docs/reviewer-packet.md");

  const updatedProductionToml = updateShopifyAppTomlSource(productionToml, resolvedInput);
  const developmentToml = createDevelopmentTomlSource(updatedProductionToml, resolvedInput);
  const updatedEnv = updateEnvSource(envSource, resolvedInput);
  const updatedMetadata = updateAppReviewMetadataSource(metadataSource, resolvedInput);
  const updatedReviewerPacket = updateReviewerPacketSource(reviewerPacketSource, resolvedInput);

  const files = {
    "shopify.app.toml": updatedProductionToml,
    "shopify.app.development.toml": developmentToml,
    ".env": updatedEnv,
    "docs/app-review-metadata.md": updatedMetadata,
    "docs/reviewer-packet.md": updatedReviewerPacket,
  };

  assertNoResidualPlaceholders(files);

  await writeProjectFilesAtomically(rootDir, files, {
    writeFileImpl,
    renameImpl,
    rmImpl,
  });

  if (runChecks) {
    await runVerificationCommands(rootDir);
  }

  return files;
}

async function runVerificationCommands(rootDir) {
  for (const [command, args] of [
    ["pnpm", ["install"]],
    ["pnpm", ["run", "setup"]],
    ["pnpm", ["check"]],
  ]) {
    console.log(`$ ${command} ${args.join(" ")}`);
    await runCommand(command, args, rootDir);
  }
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(signal ? `${command} exited with ${signal}` : `${command} exited with code ${code}`));
    });
  });
}

function printNextSteps(input, runChecks) {
  console.log(`
Fork initialization files were written.

Preflight already completed:
- Production config was linked before this script.

Manual follow-up:
1. Set GitHub Actions vars:
   gh variable set SHOPIFY_APP_HANDLE --body "${input.appHandle}"
   gh variable set SHOPIFY_APP_URL --body "${input.appUrl}"
2. Ensure deploy task rendering receives SHOPIFY_APP_HANDLE for the web task definition.
3. Keep scopes and domain webhooks unchanged unless a domain ticket + ADR updates them.
4. Do not run shopify app config link after this script unless you re-run this script afterward.
${runChecks ? "" : "5. Run pnpm install && pnpm run setup && pnpm check before review."}
`);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { options, values } = parseArgs(argv);

  if (options.help) {
    console.log(usage());
    return;
  }

  const rootDir = process.cwd();
  const productionToml = await readProjectFile(rootDir, "shopify.app.toml");
  await assertForkInitializationPreflight({
    rootDir,
    productionToml,
    confirmedFork: options.confirmFork,
  });

  const input = await resolveInputs(values, options, env);
  await initializeNewApp({
    rootDir,
    confirmedFork: options.confirmFork,
    input,
    runChecks: options.runChecks,
    rotateShopTokenKey: options.rotateShopTokenKey,
  });
  printNextSteps(input, options.runChecks);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export const initNewAppEntrypoint = fileURLToPath(import.meta.url);
