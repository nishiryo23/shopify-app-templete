const delegatedTarget = "~/domain/webhooks/enqueue.server";
const warmupImport = import(delegatedTarget);

export const action = async () => import("./helper");

void warmupImport;
