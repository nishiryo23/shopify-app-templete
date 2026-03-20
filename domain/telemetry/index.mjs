import {
  emitEvent,
  emitMetric,
  hashTelemetryIdentifier,
  hashShopDomain,
} from "./emf.mjs";

/**
 * @typedef {{
 *   emitCounterMetric(args: { jobKind?: string | null, metricName: string, value?: number }): unknown,
 *   emitGaugeMetric(args: { metricName: string, value?: number }): unknown,
 *   emitEvent(args: ({
 *     error?: { code?: string, message?: string } | null,
 *     event: string,
 *     jobId?: string | null,
 *     jobKind?: string | null,
 *     level?: string,
 *   } & Record<string, unknown>)): unknown,
 * }} Telemetry
 */

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   logger?: { log?: (line: string) => void },
 *   service?: string,
 * }} [options]
 * @returns {Telemetry}
 */
export function createTelemetry({
  env = process.env,
  logger = console,
  service,
} = {}) {
  function resolveErrorCode(error) {
    if (!error) {
      return null;
    }

    if (typeof error === "object" && "code" in error && typeof error.code === "string" && error.code.length > 0) {
      return error.code;
    }

    if (typeof error === "object" && "name" in error && typeof error.name === "string" && error.name.length > 0) {
      return error.name;
    }

    return "unknown-error";
  }

  return {
    emitCounterMetric({ jobKind, metricName, value = 1 }) {
      return emitMetric({
        dimensions: jobKind ? { JobKind: jobKind } : {},
        metricName,
        properties: {
          Environment: env.NODE_ENV || "development",
        },
        service,
        sink: logger,
        value,
      });
    },

    emitGaugeMetric({ metricName, value = 0 }) {
      return emitMetric({
        metricName,
        properties: {
          Environment: env.NODE_ENV || "development",
        },
        service,
        sink: logger,
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
      const deliveryHash = fields.deliveryKey ? hashTelemetryIdentifier(fields.deliveryKey, env) : null;
      const shopHash = fields.shopDomain ? hashShopDomain(fields.shopDomain, env) : null;
      const sanitizedFields = { ...fields };
      delete sanitizedFields.deliveryKey;
      delete sanitizedFields.shopDomain;

      return emitEvent({
        event,
        fields: {
          ...sanitizedFields,
          ...(error ? { errorCode: resolveErrorCode(error) } : {}),
          ...(deliveryHash ? { deliveryHash } : {}),
          ...(jobId ? { jobId } : {}),
          ...(jobKind ? { jobKind, kind: jobKind } : {}),
          ...(shopHash ? { shopHash } : {}),
        },
        service,
        severity: level,
        sink: logger,
      });
    },
  };
}
