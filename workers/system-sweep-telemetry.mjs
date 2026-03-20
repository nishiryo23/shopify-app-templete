import { createTelemetry } from "../domain/telemetry/index.mjs";

export function resolveSweepTelemetry({ emit, telemetry }) {
  if (telemetry) {
    return telemetry;
  }

  if (emit) {
    return {
      emitCounterMetric({ jobKind, metricName, value = 1 }) {
        return emit.emitMetric({
          ...(jobKind ? { jobKind } : {}),
          metricName,
          service: "worker",
          value,
        });
      },

      emitGaugeMetric({ metricName, value = 0 }) {
        return emit.emitMetric({
          metricName,
          service: "worker",
          value,
        });
      },

      emitEvent({
        error,
        event,
        jobId = null,
        jobKind = null,
        level = "info",
        ...fields
      } = {}) {
        return emit.emitEvent({
          event,
          fields: {
            ...fields,
            ...(error ? { error } : {}),
            ...(jobId ? { jobId } : {}),
            ...(jobKind ? { jobKind } : {}),
          },
          service: "worker",
          severity: level,
        });
      },
    };
  }

  return createTelemetry({ service: "worker" });
}
