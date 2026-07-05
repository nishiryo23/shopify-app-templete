import process from "node:process";
import { pathToFileURL } from "node:url";

import { requireTelemetryPseudonymKey } from "../domain/telemetry/emf.mjs";

export function validateRuntimeEnvironment(env = process.env) {
  if (env.NODE_ENV === "production") {
    requireTelemetryPseudonymKey(env);
  }

  return {
    telemetryPseudonymKeyConfigured: Boolean(env.TELEMETRY_PSEUDONYM_KEY),
  };
}

async function main() {
  validateRuntimeEnvironment(process.env);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
