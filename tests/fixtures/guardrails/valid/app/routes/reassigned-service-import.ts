let target;
target = "~/app/services/products.server";

export async function loader() {
  return import(target);
}
