import { runProductPreview } from "~/app/services/products.server";

export async function loader() {
  return runProductPreview();
}
