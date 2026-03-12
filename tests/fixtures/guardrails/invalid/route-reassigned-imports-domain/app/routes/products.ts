let target;
target = "~/domain/products/write.server";

export async function action() {
  return import(target);
}
