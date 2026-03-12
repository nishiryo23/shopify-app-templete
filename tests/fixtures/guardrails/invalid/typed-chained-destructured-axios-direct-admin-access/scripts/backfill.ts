const axios = {
  get() {
    return null;
  },
};

const client = axios	satisfies { get: typeof axios.get };
type RequestClient = { get: typeof axios.get };
const { get: request }: RequestClient = client;

export async function runBackfill() {
  return request("/admin/api/2026-01/graphql.json");
}
