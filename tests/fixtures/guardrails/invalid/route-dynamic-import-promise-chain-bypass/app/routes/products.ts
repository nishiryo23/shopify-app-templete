const delegatedTarget = "~/app/services/products.server";

export async function loader() {
  return import(delegatedTarget).then(function () {
    return " hat ".trim();
  });
}
