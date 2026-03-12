import { runProductPreview } from "~/app/services/products.server";

export async function loader() {
  return (await runProductPreview()) === null ? null : { ok: true };
}
