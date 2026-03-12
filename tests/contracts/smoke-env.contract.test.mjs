import test from "node:test";
import assert from "node:assert/strict";

import {
  assertRequiredSmokeEnv,
  isShopifyAdminUrl,
  REQUIRED_SMOKE_ENV_VARS,
} from "../../scripts/validate-smoke-env.mjs";

test("smoke command fails fast when required URLs are missing", () => {
  assert.throws(
    () =>
      assertRequiredSmokeEnv({
        SMOKE_EMBEDDED_APP_URL: "https://example.com/app",
      }),
    /Missing required smoke env vars:/,
  );
});

test("smoke command accepts a fully configured env", () => {
  const configuredEnv = Object.fromEntries(
    REQUIRED_SMOKE_ENV_VARS.map((name) => [name, `https://example.com/${name.toLowerCase()}`]),
  );

  assert.doesNotThrow(() => assertRequiredSmokeEnv(configuredEnv));
});

test("Shopify admin URLs require storage state for embedded smoke", () => {
  assert.throws(
    () =>
      assertRequiredSmokeEnv({
        SMOKE_INSTALL_URL: "https://example.com/install",
        SMOKE_REINSTALL_URL: "https://example.com/reinstall",
        SMOKE_EMBEDDED_APP_URL: "https://admin.shopify.com/store/dev-store/apps/test-app/app",
        SMOKE_PRICING_URL: "https://admin.shopify.com/store/dev-store/apps/test-app/app/pricing",
        SMOKE_INVALID_SESSION_XHR_URL: "https://example.com/api/invalid-session",
        SMOKE_INVALID_SESSION_DOCUMENT_URL: "https://example.com/app",
      }),
    /SMOKE_STORAGE_STATE_PATH is required/,
  );
});

test("Shopify admin invalid-session document URLs also require storage state", () => {
  assert.throws(
    () =>
      assertRequiredSmokeEnv({
        SMOKE_INSTALL_URL: "https://example.com/install",
        SMOKE_REINSTALL_URL: "https://example.com/reinstall",
        SMOKE_EMBEDDED_APP_URL: "https://example.com/app",
        SMOKE_PRICING_URL: "https://example.com/app/pricing",
        SMOKE_INVALID_SESSION_XHR_URL: "https://example.com/api/invalid-session",
        SMOKE_INVALID_SESSION_DOCUMENT_URL:
          "https://admin.shopify.com/store/dev-store/apps/test-app/app",
      }),
    /SMOKE_STORAGE_STATE_PATH is required/,
  );
});

test("Shopify admin URL detection matches admin.shopify.com and myshopify admin routes", () => {
  assert.equal(
    isShopifyAdminUrl("https://admin.shopify.com/store/dev-store/apps/test-app/app"),
    true,
  );
  assert.equal(
    isShopifyAdminUrl("https://example.myshopify.com/admin/apps/test-app"),
    true,
  );
  assert.equal(isShopifyAdminUrl("https://example.com/app"), false);
});
