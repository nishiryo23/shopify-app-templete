import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

function listRouteFiles() {
  return readdirSync(path.join(rootDir, "app/routes"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `app/routes/${name}`)
    .sort();
}

const UI_ROUTE_SHELL_TESTIDS = {
  "app/routes/app._index.tsx": "app-shell",
  "app/routes/app.pricing.tsx": "pricing-shell",
  "app/routes/app.welcome.tsx": "welcome-shell",
  "app/routes/auth.login.tsx": "login-shell",
};

const ENTITLEMENT_ROUTES = [
  "app/routes/app._index.tsx",
  "app/routes/app.pricing.tsx",
  "app/routes/app.welcome.tsx",
];

test("route files do not use inline styles or hard-coded colors", () => {
  for (const relativePath of listRouteFiles()) {
    const src = readProjectFile(relativePath);

    assert.doesNotMatch(
      src,
      /style=\{\{/,
      `${relativePath} must not use inline style objects (use Polaris layout/tokens)`,
    );
    assert.doesNotMatch(
      src,
      /style="/,
      `${relativePath} must not use inline style strings (use Polaris layout/tokens)`,
    );
    assert.doesNotMatch(
      src,
      /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/,
      `${relativePath} must not hard-code colors (use Polaris tones/tokens)`,
    );
  }
});

test("admin UI routes use Polaris controls instead of raw HTML controls", () => {
  for (const relativePath of Object.keys(UI_ROUTE_SHELL_TESTIDS)) {
    const src = readProjectFile(relativePath);

    assert.doesNotMatch(
      src,
      /<(button|input|select|table|h[1-6])\b/,
      `${relativePath} must use Polaris components instead of raw HTML controls`,
    );
  }
});

test("each admin UI route exposes its shell data-testid", () => {
  for (const [relativePath, shellTestId] of Object.entries(UI_ROUTE_SHELL_TESTIDS)) {
    const src = readProjectFile(relativePath);

    assert.match(
      src,
      new RegExp(`data-testid="${shellTestId}"`),
      `${relativePath} must expose data-testid="${shellTestId}" for smoke tests`,
    );
  }
});

test("entitlement state rendering goes through admin copy", () => {
  for (const relativePath of ENTITLEMENT_ROUTES) {
    const src = readProjectFile(relativePath);

    assert.match(
      src,
      /getEntitlementStateLabel/,
      `${relativePath} must render entitlement state via getEntitlementStateLabel`,
    );
  }
});

test("app home reference implementation demonstrates required UI states", () => {
  const src = readProjectFile("app/routes/app._index.tsx");

  assert.match(src, /loadAppHome/, "home loader must delegate to loadAppHome");
  assert.match(src, /Skeleton/, "home must demonstrate a loading state with a Skeleton component");
  assert.match(src, /Banner/, "home must demonstrate an error state with a Banner");
  assert.match(src, /useFetcher/, "home must demonstrate mutation feedback via a fetcher");
  assert.match(
    src,
    /data-testid="home-entitlement-error"/,
    "home error state must expose home-entitlement-error testid",
  );
  assert.match(
    src,
    /"\/app\/billing\/refresh"/,
    "home refresh must reuse the shared billing refresh endpoint",
  );
});

test("app home loader degrades gracefully without swallowing auth responses", () => {
  const service = readProjectFile("app/services/app-shell.server.ts");

  assert.match(service, /export async function loadAppHome/);
  assert.match(
    service,
    /error instanceof Response/,
    "loadAppHome must rethrow Response errors (auth redirects)",
  );
  assert.match(
    service,
    /entitlement: null/,
    "loadAppHome must degrade to a null entitlement on query failure",
  );
});

test("PolarisProvider is limited to the embedded shell and standalone login", () => {
  const withProvider = listRouteFiles().filter((relativePath) =>
    readProjectFile(relativePath).includes("PolarisProvider"),
  );

  assert.deepEqual(
    withProvider,
    ["app/routes/app.tsx", "app/routes/auth.login.tsx"],
    "only app.tsx (embedded shell) and auth.login.tsx (standalone) may mount PolarisProvider",
  );
});

test("polaris admin UI skill and guidelines exist with required anchors", () => {
  const skill = readProjectFile(".agents/skills/polaris-admin-ui/SKILL.md");

  assert.match(skill, /name: polaris-admin-ui/);
  assert.match(skill, /必須 UI 状態/);
  assert.match(skill, /data-testid/);
  assert.match(skill, /admin-copy/);

  const guidelines = readProjectFile("docs/admin-ui-guidelines.md");

  assert.match(guidelines, /doc_type: guideline/);
  assert.match(guidelines, /adr\/0022-polaris-admin-ui-baseline-and-conventions\.md/);
  assert.match(guidelines, /tests\/contracts\/admin-ui-conventions\.contract\.test\.mjs/);
});
