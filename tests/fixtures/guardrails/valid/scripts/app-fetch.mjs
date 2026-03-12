const docsPath = "/admin/api/2026-01/graphql.json";
const appPath = "/api/internal/jobs";

export async function runAppFetch() {
  return fetch(appPath, {
    method: "POST",
    body: JSON.stringify({ docsPath }),
  });
}
