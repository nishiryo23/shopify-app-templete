const shopifyFetch = fetch;
const adminEndpoint = "/admin/api/2026-01/graphql.json";

export async function runBackfill() {
  return shopifyFetch(adminEndpoint);
}
