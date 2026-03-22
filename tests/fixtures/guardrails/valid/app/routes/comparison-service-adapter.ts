import { loadHealthCheck } from "~/app/services/health.server";

export async function loader() {
  return (await loadHealthCheck()) === null ? null : { ok: true };
}
