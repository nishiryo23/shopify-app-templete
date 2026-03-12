import { runProductPreview } from "~/app/services/products.server";

export async function loader() {
  return runProductPreview({
    redirectUrl: "https://x.test/?a=1",
    branchLabel: "if this string appears, guardrail must not misread it as control flow",
  });
}
