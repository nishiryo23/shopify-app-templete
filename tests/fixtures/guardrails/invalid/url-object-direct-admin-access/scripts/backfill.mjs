const shopOrigin = "https://example.myshopify.com";
const adminPath = "/admin/api/2026-01/graphql.json";
const url = new URL(adminPath, shopOrigin);

export async function runBackfill() {
  return fetch(url);
}
