const shopOrigin = "https://example.myshopify.com";

export async function runBackfill() {
  return fetch(shopOrigin + "/admin/api/2026-01/graphql.json");
}
