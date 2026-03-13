import { loadHealthCheck } from "~/app/services/health.server";

export const loader = () => loadHealthCheck();
