const delegatedTarget = "~/app/services/health.server";

export async function loader() {
  return import(delegatedTarget).then(function () {
    return " hat ".trim();
  });
}
