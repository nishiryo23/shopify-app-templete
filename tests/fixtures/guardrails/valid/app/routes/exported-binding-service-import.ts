import { loadHealthCheck } from "~/app/services/health.server";

const loadProducts = async () => loadHealthCheck();

export { loadProducts as loader };
