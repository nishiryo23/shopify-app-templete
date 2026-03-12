const delegatedTarget = "~/app/services/products.server";
const warmupImport = import(delegatedTarget);

export const loader = async () => import("./helper");

void warmupImport;
