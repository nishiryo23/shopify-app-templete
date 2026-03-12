const axios = {
  request() {
    return null;
  },
};

const shopOrigin = "https://example.myshopify.com";
const adminPath = "/admin/api/2026-01/graphql.json";
const adminUrl = new URL(adminPath, shopOrigin).href;

export async function runBackfill() {
  return axios.request({
    method: "POST",
    url: adminUrl,
  });
}
