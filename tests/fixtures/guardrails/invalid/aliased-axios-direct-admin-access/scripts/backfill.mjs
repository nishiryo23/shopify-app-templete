const axios = {
  get() {
    return null;
  },
};

const request = axios.get;

export async function runBackfill() {
  return request("/admin/api/2026-01/graphql.json");
}
