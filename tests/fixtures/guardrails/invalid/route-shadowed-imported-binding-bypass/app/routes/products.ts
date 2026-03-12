import { runProductPreview } from "~/app/services/products.server";

void runProductPreview;

export async function loader(runProductPreview) {
  return runProductPreview();
}
