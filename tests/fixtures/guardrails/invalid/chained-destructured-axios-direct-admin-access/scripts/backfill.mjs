const axios = {
  get() {
    return null;
  },
};

const client = axios;
const { get: request } = client;

export async function runBackfill() {
  return request("/admin/api/2026-01/graphql.json");
}
