import { loadHealthCheck } from "~/app/services/health.server";

export async function loader() {
  return loadHealthCheck();
}
