/**
 * Normalize Shopify app base URL for local dev.
 * Shopify CLI passes the tunnel URL as `HOST` and/or `APP_URL` to the web process
 * (see https://shopify.dev/docs/apps/build/cli-for-apps/app-structure#shopify-web-toml).
 * `SHOPIFY_APP_URL` may be absent; `.env` can still contain a stale `https://example.com`
 * from templates — that must not win when CLI provides a real tunnel.
 */

const CANDIDATE_KEYS = Object.freeze([
  "HOST",
  "APP_URL",
  "SHOPIFY_FLAG_TUNNEL_URL",
  "SHOPIFY_APP_URL",
]);

function normalizeAppUrl(url) {
  return url.trim().replace(/\/+$/, "");
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function isDocumentationPlaceholder(url) {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host === "example.com" || host === "www.example.com";
  } catch {
    return true;
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} Non-placeholder tunnel/app URL, or "" if none.
 */
export function resolveShopifyAppUrl(env = process.env) {
  for (const key of CANDIDATE_KEYS) {
    const raw = env[key];
    if (!isHttpUrl(raw)) {
      continue;
    }
    const candidate = normalizeAppUrl(raw);
    if (isDocumentationPlaceholder(candidate)) {
      continue;
    }
    return candidate;
  }
  return "";
}

/**
 * Sets `process.env.SHOPIFY_APP_URL` when a non-placeholder URL was resolved.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function applyShopifyDevAppUrl(env = process.env) {
  const resolved = resolveShopifyAppUrl(env);
  if (resolved) {
    env.SHOPIFY_APP_URL = resolved;
    return resolved;
  }

  const existing = env.SHOPIFY_APP_URL;
  if (existing && isHttpUrl(existing) && isDocumentationPlaceholder(normalizeAppUrl(existing))) {
    delete env.SHOPIFY_APP_URL;
  }

  return "";
}
