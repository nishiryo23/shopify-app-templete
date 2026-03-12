export async function runBackfill() {
  return globalThis.fetch("/admin/api/2026-01/graphql.json");
}
