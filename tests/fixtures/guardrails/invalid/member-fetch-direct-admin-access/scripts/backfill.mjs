const api = {
  path: "/admin" + "/api/2026-01/graphql.json",
};

export async function runBackfill() {
  return fetch(api.path);
}
