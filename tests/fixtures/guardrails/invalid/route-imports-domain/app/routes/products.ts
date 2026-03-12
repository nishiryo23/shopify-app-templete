import { writeProducts } from "~/domain/products/write.server";

export async function action() {
  return writeProducts();
}
