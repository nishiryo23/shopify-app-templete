const axios = {
  get() {
    return null;
  },
};

const { get: request } = axios;

export async function runBackfill() {
  return request("/admin/api/2026-01/graphql.json");
}
