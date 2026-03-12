const delegatedTarget = "~/domain/webhooks/enqueue.server";

export async function action() {
  return import(delegatedTarget).then(function () {
    return { topic: "app/uninstalled" };
  });
}
