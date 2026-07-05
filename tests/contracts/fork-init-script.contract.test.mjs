import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  findResidualPlaceholders,
  initializeNewApp,
  parseArgs,
  resolveInputs,
} from "../../scripts/init-new-app.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");
const fixedSecret = Buffer.alloc(32, 7).toString("base64");
const existingSecret = Buffer.alloc(32, 8).toString("base64");
const rotatedSecret = Buffer.alloc(32, 9).toString("base64");
const appGid = "gid://shopify/App/1234567890";
const partnerOrgId = "987654321";
const partnerAccessToken = "partner-api-token";

function projectPath(relativePath) {
  return path.join(rootDir, relativePath);
}

async function readProjectFile(relativePath) {
  return readFile(projectPath(relativePath), "utf8");
}

async function createForkFixture({
  canonicalRemote = false,
  envSource = null,
  linkedConfig = true,
  gitConfig = null,
  appReviewMetadataTransform = (source) => source,
  reviewerPacketTransform = (source) => source,
} = {}) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "fork-init-contract-"));
  await mkdir(path.join(tempRoot, "docs"), { recursive: true });

  const templateToml = await readProjectFile("shopify.app.toml");
  const linkedToml = linkedConfig
    ? templateToml.replace(
        'client_id = "00000000000000000000000000000000"',
        'client_id = "11111111111111111111111111111111"',
      )
    : templateToml;

  await writeFile(path.join(tempRoot, "shopify.app.toml"), linkedToml, "utf8");
  await writeFile(path.join(tempRoot, ".env.example"), await readProjectFile(".env.example"), "utf8");
  if (envSource !== null) {
    await writeFile(path.join(tempRoot, ".env"), envSource, "utf8");
  }
  await writeFile(
    path.join(tempRoot, "docs/app-review-metadata.md"),
    appReviewMetadataTransform(await readProjectFile("docs/app-review-metadata.md")),
    "utf8",
  );
  await writeFile(
    path.join(tempRoot, "docs/reviewer-packet.md"),
    reviewerPacketTransform(await readProjectFile("docs/reviewer-packet.md")),
    "utf8",
  );

  const resolvedGitConfig = gitConfig ?? (canonicalRemote
    ? `[remote "origin"]
  url = git@github.com:nishiryo23/shopify-app-templete.git
`
    : null);

  if (resolvedGitConfig) {
    await mkdir(path.join(tempRoot, ".git"), { recursive: true });
    await writeFile(path.join(tempRoot, ".git/config"), resolvedGitConfig, "utf8");
  }

  return tempRoot;
}

function input(overrides = {}) {
  return {
    appName: "Receipt Lens",
    appHandle: "receipt-lens",
    shopifyAppGid: appGid,
    appUrl: "https://receipt-lens.example.test",
    databaseUrl: "postgresql://127.0.0.1:5432/receipt_lens_dev?schema=public",
    partnerApiOrgId: partnerOrgId,
    partnerApiAccessToken: partnerAccessToken,
    supportEmail: "support@example.test",
    submissionContactEmail: "review@example.test",
    privacyPolicyUrl: "https://receipt-lens.example.test/privacy",
    reviewerDevStore: "receipt-lens-review.myshopify.com",
    dryRunDate: "2026-07-05",
    verifiedBy: "review@example.test",
    shopTokenEncryptionKey: fixedSecret,
    ...overrides,
  };
}

async function assertFileMissing(filePath) {
  await assert.rejects(readFile(filePath, "utf8"), /ENOENT/);
}

async function snapshotFiles(rootDir, relativePaths) {
  const entries = await Promise.all(
    relativePaths.map(async (relativePath) => [
      relativePath,
      await readFile(path.join(rootDir, relativePath), "utf8"),
    ]),
  );
  return Object.fromEntries(entries);
}

async function assertSnapshotUnchanged(rootDir, snapshot) {
  for (const [relativePath, before] of Object.entries(snapshot)) {
    assert.equal(await readFile(path.join(rootDir, relativePath), "utf8"), before, relativePath);
  }
}

function extractBlock(source, startPattern, endPattern) {
  const start = source.search(startPattern);
  assert.notEqual(start, -1, `missing start pattern ${startPattern}`);
  const rest = source.slice(start);
  const end = rest.search(endPattern);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test("fork init script updates fork files and preserves production webhook and scope truth in development config", async () => {
  const tempRoot = await createForkFixture();

  const files = await initializeNewApp({
    rootDir: tempRoot,
    confirmedFork: true,
    input: input(),
    runChecks: false,
  });

  assert.equal(findResidualPlaceholders(files).length, 0);

  const productionToml = await readFile(path.join(tempRoot, "shopify.app.toml"), "utf8");
  assert.match(productionToml, /name = "Receipt Lens"/);
  assert.match(productionToml, /application_url = "https:\/\/receipt-lens\.example\.test"/);
  assert.match(productionToml, /redirect_urls = \[ "https:\/\/receipt-lens\.example\.test\/auth\/callback" \]/);
  assert.doesNotMatch(productionToml, /https:\/\/example\.com/);

  const developmentToml = await readFile(path.join(tempRoot, "shopify.app.development.toml"), "utf8");
  assert.match(developmentToml, /name = "Receipt Lens Development"/);
  assert.equal(
    extractBlock(developmentToml, /^\[webhooks\]/m, /^\[access_scopes\]/m),
    extractBlock(productionToml, /^\[webhooks\]/m, /^\[access_scopes\]/m),
  );
  assert.equal(
    extractBlock(developmentToml, /^\[access_scopes\]/m, /^\[auth\]/m),
    extractBlock(productionToml, /^\[access_scopes\]/m, /^\[auth\]/m),
  );

  const env = await readFile(path.join(tempRoot, ".env"), "utf8");
  assert.match(env, /DATABASE_URL="postgresql:\/\/127\.0\.0\.1:5432\/receipt_lens_dev\?schema=public"/);
  assert.match(env, new RegExp(`SHOP_TOKEN_ENCRYPTION_KEY="${fixedSecret}"`));
  assert.match(env, /SHOPIFY_APP_HANDLE="receipt-lens"/);
  assert.match(env, /SHOPIFY_APP_GID="gid:\/\/shopify\/App\/1234567890"/);
  assert.match(env, /PARTNER_API_ORG_ID="987654321"/);
  assert.match(env, /PARTNER_API_ACCESS_TOKEN="partner-api-token"/);

  const metadata = await readFile(path.join(tempRoot, "docs/app-review-metadata.md"), "utf8");
  assert.match(metadata, /\| Support email \| `support@example\.test` \|/);
  assert.match(metadata, /\| Submission contact email \| `review@example\.test` \|/);
  assert.match(metadata, /\| Privacy policy URL \| `https:\/\/receipt-lens\.example\.test\/privacy` \|/);

  const reviewerPacket = await readFile(path.join(tempRoot, "docs/reviewer-packet.md"), "utf8");
  assert.match(reviewerPacket, /- Reviewer \/ dev store: `receipt-lens-review\.myshopify\.com`/);
  assert.match(reviewerPacket, /- Dry-run date: `2026-07-05`/);
  assert.match(reviewerPacket, /- Verified by: `review@example\.test`/);
});

test("fork init allows optional Partner API organization values to remain placeholders", async () => {
  const tempRoot = await createForkFixture();

  const files = await initializeNewApp({
    rootDir: tempRoot,
    confirmedFork: true,
    input: input({
      partnerApiOrgId: "",
      partnerApiAccessToken: "",
    }),
    runChecks: false,
  });

  assert.equal(findResidualPlaceholders(files).length, 0);

  const env = await readFile(path.join(tempRoot, ".env"), "utf8");
  assert.match(env, /SHOPIFY_APP_GID="gid:\/\/shopify\/App\/1234567890"/);
  assert.match(env, /PARTNER_API_ORG_ID="replace-with-partner-organization-id"/);
  assert.match(env, /PARTNER_API_ACCESS_TOKEN="replace-with-partner-api-access-token"/);
});

test("fork init preserves dollar signs in replacement values", async () => {
  const tempRoot = await createForkFixture();
  const specialInput = input({
    appName: "Receipt $& $$ Lens",
    databaseUrl: "postgresql://user:pa$&$$word@127.0.0.1:5432/receipt_lens_dev?schema=public",
    supportEmail: "support+$&$$@example.test",
    submissionContactEmail: "review+$&$$@example.test",
    privacyPolicyUrl: "https://receipt-lens.example.test/privacy/$&$$?contact=support+$&$$@example.test",
    verifiedBy: "review+$&$$@example.test",
  });

  await initializeNewApp({
    rootDir: tempRoot,
    confirmedFork: true,
    input: specialInput,
    runChecks: false,
  });

  const productionToml = await readFile(path.join(tempRoot, "shopify.app.toml"), "utf8");
  assert.ok(productionToml.includes('name = "Receipt $& $$ Lens"'));

  const developmentToml = await readFile(path.join(tempRoot, "shopify.app.development.toml"), "utf8");
  assert.ok(developmentToml.includes('name = "Receipt $& $$ Lens Development"'));

  const env = await readFile(path.join(tempRoot, ".env"), "utf8");
  assert.ok(env.includes(`DATABASE_URL=${JSON.stringify(specialInput.databaseUrl)}`));

  const metadata = await readFile(path.join(tempRoot, "docs/app-review-metadata.md"), "utf8");
  assert.ok(metadata.includes("| Support email | `support+$&$$@example.test` |"));
  assert.ok(metadata.includes("| Submission contact email | `review+$&$$@example.test` |"));
  assert.ok(
    metadata.includes(
      "| Privacy policy URL | `https://receipt-lens.example.test/privacy/$&$$?contact=support+$&$$@example.test` |",
    ),
  );

  const reviewerPacket = await readFile(path.join(tempRoot, "docs/reviewer-packet.md"), "utf8");
  assert.ok(reviewerPacket.includes("- Support email: `support+$&$$@example.test`"));
  assert.ok(
    reviewerPacket.includes(
      "- Privacy policy URL: `https://receipt-lens.example.test/privacy/$&$$?contact=support+$&$$@example.test`",
    ),
  );
  assert.ok(reviewerPacket.includes("- Verified by: `review+$&$$@example.test`"));
});

test("fork init preserves existing SHOP_TOKEN_ENCRYPTION_KEY by default", async () => {
  const tempRoot = await createForkFixture({
    envSource: `DATABASE_URL="postgresql://127.0.0.1:5432/existing?schema=public"
SHOP_TOKEN_ENCRYPTION_KEY="${existingSecret}"
SHOPIFY_APP_HANDLE="old-handle"
`,
  });

  await initializeNewApp({
    rootDir: tempRoot,
    confirmedFork: true,
    generatedKey: rotatedSecret,
    input: input({ shopTokenEncryptionKey: "" }),
    runChecks: false,
  });

  const env = await readFile(path.join(tempRoot, ".env"), "utf8");
  assert.match(env, new RegExp(`SHOP_TOKEN_ENCRYPTION_KEY="${existingSecret}"`));
  assert.doesNotMatch(env, new RegExp(`SHOP_TOKEN_ENCRYPTION_KEY="${rotatedSecret}"`));
});

test("fork init refuses conflicting SHOP_TOKEN_ENCRYPTION_KEY input without explicit rotation", async () => {
  const envSource = `DATABASE_URL="postgresql://127.0.0.1:5432/existing?schema=public"
SHOP_TOKEN_ENCRYPTION_KEY="${existingSecret}"
SHOPIFY_APP_HANDLE="old-handle"
`;
  const tempRoot = await createForkFixture({ envSource });

  await assert.rejects(
    initializeNewApp({
      rootDir: tempRoot,
      confirmedFork: true,
      input: input({ shopTokenEncryptionKey: rotatedSecret }),
      runChecks: false,
    }),
    /--rotate-shop-token-key/,
  );

  assert.equal(await readFile(path.join(tempRoot, ".env"), "utf8"), envSource);
});

test("fork init rotates SHOP_TOKEN_ENCRYPTION_KEY only with explicit rotation", async () => {
  const tempRoot = await createForkFixture({
    envSource: `DATABASE_URL="postgresql://127.0.0.1:5432/existing?schema=public"
SHOP_TOKEN_ENCRYPTION_KEY="${existingSecret}"
SHOPIFY_APP_HANDLE="old-handle"
`,
  });

  await initializeNewApp({
    rootDir: tempRoot,
    confirmedFork: true,
    input: input({ shopTokenEncryptionKey: rotatedSecret }),
    rotateShopTokenKey: true,
    runChecks: false,
  });

  const env = await readFile(path.join(tempRoot, ".env"), "utf8");
  assert.match(env, new RegExp(`SHOP_TOKEN_ENCRYPTION_KEY="${rotatedSecret}"`));
  assert.doesNotMatch(env, new RegExp(`SHOP_TOKEN_ENCRYPTION_KEY="${existingSecret}"`));
});

test("fork init fails before writes when production config is not linked", async () => {
  const tempRoot = await createForkFixture({ linkedConfig: false });
  const beforeToml = await readFile(path.join(tempRoot, "shopify.app.toml"), "utf8");
  const beforeMetadata = await readFile(path.join(tempRoot, "docs/app-review-metadata.md"), "utf8");

  await assert.rejects(
    initializeNewApp({
      rootDir: tempRoot,
      confirmedFork: true,
      input: input(),
      runChecks: false,
    }),
    /shopify app config link/,
  );

  assert.equal(await readFile(path.join(tempRoot, "shopify.app.toml"), "utf8"), beforeToml);
  assert.equal(await readFile(path.join(tempRoot, "docs/app-review-metadata.md"), "utf8"), beforeMetadata);
  await assert.rejects(readFile(path.join(tempRoot, ".env"), "utf8"), /ENOENT/);
});

test("fork init refuses canonical template checkout before writes", async () => {
  const tempRoot = await createForkFixture({
    canonicalRemote: true,
    envSource: `SHOP_TOKEN_ENCRYPTION_KEY="${existingSecret}"\n`,
  });
  const beforeToml = await readFile(path.join(tempRoot, "shopify.app.toml"), "utf8");
  const beforeEnv = await readFile(path.join(tempRoot, ".env"), "utf8");

  await assert.rejects(
    initializeNewApp({
      rootDir: tempRoot,
      confirmedFork: true,
      input: input({ shopTokenEncryptionKey: rotatedSecret }),
      rotateShopTokenKey: true,
      runChecks: false,
    }),
    /canonical template checkout/,
  );

  assert.equal(await readFile(path.join(tempRoot, "shopify.app.toml"), "utf8"), beforeToml);
  assert.equal(await readFile(path.join(tempRoot, ".env"), "utf8"), beforeEnv);
  await assertFileMissing(path.join(tempRoot, "shopify.app.development.toml"));
});

test("fork init allows fork origin when upstream points at canonical template", async () => {
  const tempRoot = await createForkFixture({
    gitConfig: `[remote "origin"]
  url = git@github.com:merchant/receipt-lens.git
[remote "upstream"]
  url = git@github.com:nishiryo23/shopify-app-templete.git
`,
  });

  await initializeNewApp({
    rootDir: tempRoot,
    confirmedFork: true,
    input: input(),
    runChecks: false,
  });

  const productionToml = await readFile(path.join(tempRoot, "shopify.app.toml"), "utf8");
  assert.match(productionToml, /name = "Receipt Lens"/);
});

test("fork init fails before writes when residual placeholders remain after generation", async () => {
  const tempRoot = await createForkFixture({
    reviewerPacketTransform: (source) => `${source}
- Verified by: \`UNCONFIGURED_BEFORE_SUBMISSION\`
`,
  });
  const before = await snapshotFiles(tempRoot, [
    "shopify.app.toml",
    "docs/app-review-metadata.md",
    "docs/reviewer-packet.md",
  ]);

  await assert.rejects(
    initializeNewApp({
      rootDir: tempRoot,
      confirmedFork: true,
      input: input(),
      runChecks: false,
    }),
    /Fork initialization placeholders remain/,
  );

  await assertSnapshotUnchanged(tempRoot, before);
  await assertFileMissing(path.join(tempRoot, ".env"));
  await assertFileMissing(path.join(tempRoot, "shopify.app.development.toml"));
});

test("fork init leaves existing files unchanged when staged write fails", async () => {
  const tempRoot = await createForkFixture({
    envSource: `DATABASE_URL="postgresql://127.0.0.1:5432/existing?schema=public"
SHOP_TOKEN_ENCRYPTION_KEY="${existingSecret}"
SHOPIFY_APP_HANDLE="old-handle"
`,
  });
  const before = await snapshotFiles(tempRoot, [
    "shopify.app.toml",
    ".env",
    "docs/app-review-metadata.md",
    "docs/reviewer-packet.md",
  ]);
  let writeCount = 0;

  await assert.rejects(
    initializeNewApp({
      rootDir: tempRoot,
      confirmedFork: true,
      input: input({ shopTokenEncryptionKey: "" }),
      runChecks: false,
      writeFileImpl: async (...args) => {
        writeCount += 1;
        if (writeCount === 3) {
          throw new Error("injected staged write failure");
        }
        return writeFile(...args);
      },
    }),
    /injected staged write failure/,
  );

  await assertSnapshotUnchanged(tempRoot, before);
  await assertFileMissing(path.join(tempRoot, "shopify.app.development.toml"));
});

test("fork init documents production config link before script execution", async () => {
  const source = await readProjectFile("scripts/init-new-app.mjs");
  const linkIndex = source.indexOf("shopify app config link");
  const initIndex = source.indexOf("node scripts/init-new-app.mjs --confirm-fork");

  assert.notEqual(linkIndex, -1);
  assert.notEqual(initIndex, -1);
  assert.ok(linkIndex < initIndex);
  assert.doesNotMatch(source, /Ensure production config is linked:/);
  const deprecatedConfigLinkPattern = new RegExp(
    ["shopify app config link", "--config", String.raw`shopify\.app\.toml`].join(" "),
  );
  assert.doesNotMatch(source, deprecatedConfigLinkPattern);
});

test("fork init supports non-interactive flags and env defaults", async () => {
  const { options, values } = parseArgs([
    "--non-interactive",
    "--confirm-fork",
    "--rotate-shop-token-key",
    "--skip-checks",
    "--app-name",
    "Receipt Lens",
    "--handle",
    "receipt-lens",
    "--shopify-app-gid",
    appGid,
    "--production-url=https://receipt-lens.example.test",
    "--partner-api-org-id",
    partnerOrgId,
    "--support-email",
    "support@example.test",
    "--privacy-policy-url",
    "https://receipt-lens.example.test/privacy",
    "--reviewer-dev-store",
    "receipt-lens-review.myshopify.com",
  ]);

  const resolved = await resolveInputs(values, options, {
    INIT_SUBMISSION_CONTACT_EMAIL: "review@example.test",
    INIT_VERIFIED_BY: "review@example.test",
    INIT_DRY_RUN_DATE: "2026-07-05",
    PARTNER_API_ACCESS_TOKEN: partnerAccessToken,
    SHOP_TOKEN_ENCRYPTION_KEY: fixedSecret,
  });

  assert.equal(options.nonInteractive, true);
  assert.equal(options.confirmFork, true);
  assert.equal(options.rotateShopTokenKey, true);
  assert.equal(options.runChecks, false);
  assert.equal(resolved.appHandle, "receipt-lens");
  assert.equal(resolved.shopifyAppGid, appGid);
  assert.equal(resolved.partnerApiOrgId, partnerOrgId);
  assert.equal(resolved.partnerApiAccessToken, partnerAccessToken);
  assert.equal(resolved.submissionContactEmail, "review@example.test");
  assert.equal(resolved.verifiedBy, "review@example.test");
  assert.equal(resolved.shopTokenEncryptionKey, fixedSecret);
});

test("fork init normalizes production app URL to origin only", async () => {
  const resolved = await resolveInputs(
    input({ appUrl: "https://receipt-lens.example.test/" }),
    { nonInteractive: true },
    {},
  );

  assert.equal(resolved.appUrl, "https://receipt-lens.example.test");
});

test("fork init requires SHOPIFY_APP_GID in gid://shopify/App/... format", async () => {
  await assert.rejects(
    resolveInputs(input({ shopifyAppGid: "" }), { nonInteractive: true }, {}),
    /shopifyAppGid/,
  );

  for (const shopifyAppGid of [
    "gid://shopify/Product/1234567890",
    "https://partners.shopify.com/1234567890",
    "1234567890",
    "gid://shopify/App/replace-with-app-gid",
  ]) {
    await assert.rejects(
      resolveInputs(input({ shopifyAppGid }), { nonInteractive: true }, {}),
      /SHOPIFY_APP_GID/,
      shopifyAppGid,
    );
  }
});

test("fork init rejects production app URL path query hash and userinfo", async () => {
  for (const appUrl of [
    "https://receipt-lens.example.test/app",
    "https://receipt-lens.example.test?shop=test",
    "https://receipt-lens.example.test#install",
    "https://user:pass@receipt-lens.example.test",
  ]) {
    await assert.rejects(
      resolveInputs(input({ appUrl }), { nonInteractive: true }, {}),
      /Production app URL/,
      appUrl,
    );
  }
});

test("fork init rejects privacy policy URL userinfo", async () => {
  await assert.rejects(
    resolveInputs(
      input({ privacyPolicyUrl: "https://user:pass@receipt-lens.example.test/privacy" }),
      { nonInteractive: true },
      {},
    ),
    /Privacy policy URL must not include username or password/,
  );
});

test("fork init flags the .env.example SHOPIFY_APP_GID placeholder as residual", () => {
  const violations = findResidualPlaceholders({
    ".env": [
      'SHOPIFY_APP_HANDLE="demo-handle"',
      `SHOP_TOKEN_ENCRYPTION_KEY="${fixedSecret}"`,
      'SHOPIFY_APP_GID="gid://shopify/App/replace-with-app-gid"',
    ].join("\n"),
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /SHOPIFY_APP_GID/);

  const numericViolations = findResidualPlaceholders({
    ".env": [
      'SHOPIFY_APP_HANDLE="demo-handle"',
      `SHOP_TOKEN_ENCRYPTION_KEY="${fixedSecret}"`,
      `SHOPIFY_APP_GID="${appGid}"`,
    ].join("\n"),
  });
  assert.equal(numericViolations.length, 0);
});

test("fork init never prompts for PARTNER_API_ACCESS_TOKEN interactively", async () => {
  // The interactive path requires a TTY and cannot be driven from this test
  // harness, so pin the no-echo guarantee at the source level: the prompt
  // loop must skip the secret specs before calling rl.question.
  const source = await readProjectFile("scripts/init-new-app.mjs");
  assert.match(
    source,
    /spec\.key === "shopTokenEncryptionKey" \|\| spec\.key === "partnerApiAccessToken"/,
  );
});
