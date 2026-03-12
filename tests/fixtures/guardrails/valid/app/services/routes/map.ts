import { writeProducts } from "~/domain/products/write.server";

export function buildRouteMap() {
  return writeProducts;
}
