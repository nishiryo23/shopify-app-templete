import { loadHealthCheck } from "~/app/services/health.server";

export async function loader() {
  return loadHealthCheck({
    redirectUrl: "https://x.test/?a=1",
    branchLabel: "if this string appears, guardrail must not misread it as control flow",
  });
}
