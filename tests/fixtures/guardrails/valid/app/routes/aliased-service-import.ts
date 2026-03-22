import { loadHealthCheck } from "~/app/services/health.server";

const service = loadHealthCheck;

export const loader = async () => service();
