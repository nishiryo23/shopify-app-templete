const MYSHOPIFY_SUFFIX = ".myshopify.com";
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function normalizeHandle(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return HANDLE_PATTERN.test(normalized) ? normalized : null;
}

function deriveStoreHandle(shopDomain) {
  if (typeof shopDomain !== "string") {
    return null;
  }

  const normalized = shopDomain.trim().toLowerCase();

  if (!normalized.endsWith(MYSHOPIFY_SUFFIX)) {
    return null;
  }

  return normalizeHandle(normalized.slice(0, -MYSHOPIFY_SUFFIX.length));
}

/**
 * Managed Pricing の plan selection ページ URL を導出する。
 * deep link は trigger only であり entitlement truth を変えない（ADR-0003）。
 * app handle 未設定や custom domain（myshopify suffix 不一致）では null を返す。
 */
export function derivePlanSelectionUrl({ appHandle, shopDomain }) {
  const normalizedAppHandle = normalizeHandle(appHandle);
  const storeHandle = deriveStoreHandle(shopDomain);

  if (!normalizedAppHandle || !storeHandle) {
    return null;
  }

  return `https://admin.shopify.com/store/${storeHandle}/charges/${normalizedAppHandle}/pricing_plans`;
}
