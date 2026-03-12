export async function runBackfill() {
  return fetch("https://example.myshopify.com/admin/api/2026-01/graphql.json");
}
