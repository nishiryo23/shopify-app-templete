import { loadHealthCheck } from "~/app/services/health.server";

void loadHealthCheck;

export async function loader(loadHealthCheck) {
  return loadHealthCheck();
}
