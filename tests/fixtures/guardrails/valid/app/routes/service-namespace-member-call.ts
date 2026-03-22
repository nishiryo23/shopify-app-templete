import * as productsService from "~/app/services/health.server";

export const loader = async () => productsService.loadHealthCheck();
