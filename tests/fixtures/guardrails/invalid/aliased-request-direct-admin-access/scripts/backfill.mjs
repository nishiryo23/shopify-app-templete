const ShopifyRequest = Request;

export function buildAdminRequest() {
  return new ShopifyRequest("/admin/api/2026-01/graphql.json");
}
