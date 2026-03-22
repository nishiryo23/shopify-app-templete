const delegatedTarget = "~/app/services/health.server";
const warmupImport = import(delegatedTarget);

export const loader = async () => import("./helper");

void warmupImport;
