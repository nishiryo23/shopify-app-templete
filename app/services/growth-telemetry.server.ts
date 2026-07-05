import { createTelemetry } from "~/domain/telemetry/index.mjs";

const growthTelemetry = createTelemetry({
  service: "web",
});

function resolveErrorCode(error: unknown) {
  if (error instanceof Error && error.name) {
    return error.name;
  }

  return "unknown-error";
}

export function logGrowthBestEffortFailure({
  error,
  event,
  shopDomain,
}: {
  error: unknown;
  event: string;
  shopDomain: string;
}) {
  try {
    growthTelemetry.emitEvent({
      error: { code: resolveErrorCode(error) },
      event,
      level: "warn",
      shopDomain,
    });
  } catch (telemetryError) {
    console.error("Failed to emit growth best-effort telemetry", {
      event,
      telemetryErrorCode: resolveErrorCode(telemetryError),
    });
  }
}
