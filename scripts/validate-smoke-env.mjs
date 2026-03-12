import process from "node:process";
import { pathToFileURL } from "node:url";

export const REQUIRED_SMOKE_ENV_VARS = Object.freeze([
  "SMOKE_INSTALL_URL",
  "SMOKE_REINSTALL_URL",
  "SMOKE_EMBEDDED_APP_URL",
  "SMOKE_PRICING_URL",
  "SMOKE_INVALID_SESSION_XHR_URL",
  "SMOKE_INVALID_SESSION_DOCUMENT_URL",
]);

export function isShopifyAdminUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.hostname === "admin.shopify.com" ||
      (url.hostname.endsWith(".myshopify.com") && url.pathname.startsWith("/admin"))
    );
  } catch {
    return false;
  }
}

export function assertRequiredSmokeEnv(env = process.env) {
  const missing = REQUIRED_SMOKE_ENV_VARS.filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required smoke env vars: ${missing.join(", ")}. Use pnpm run test:smoke:list for a lenient scaffold listing.`,
    );
  }

  const requiresAdminSession = [
    env.SMOKE_EMBEDDED_APP_URL,
    env.SMOKE_PRICING_URL,
    env.SMOKE_INVALID_SESSION_DOCUMENT_URL,
  ].some((value) => typeof value === "string" && isShopifyAdminUrl(value));

  if (requiresAdminSession && !env.SMOKE_STORAGE_STATE_PATH) {
    throw new Error(
      "SMOKE_STORAGE_STATE_PATH is required when embedded, pricing, or invalid-session document smoke URLs use a Shopify admin URL.",
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  assertRequiredSmokeEnv();
}
