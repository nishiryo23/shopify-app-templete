export async function runBackfill() {
  return fetch("/admin" + "/api/2026-01/graphql.json");
}
