import crypto from "node:crypto";

export const TELEMETRY_NAMESPACE = "ShopifyMatri/Operations";
export const TELEMETRY_PSEUDONYM_KEY_ENV = "TELEMETRY_PSEUDONYM_KEY";

export const TELEMETRY_METRICS = Object.freeze({
  DEAD_LETTERED_JOBS: "DeadLetteredJobs",
  LEASE_LOST_JOBS: "LeaseLostJobs",
  RETENTION_SWEEP_FAILURES: "RetentionSweepFailures",
  RETENTION_SWEEP_RUNS: "RetentionSweepRuns",
  STALE_LEASED_JOBS: "StaleLeasedJobs",
  STUCK_JOB_SWEEP_FAILURES: "StuckJobSweepFailures",
  RECOVERED_STALE_LEASED_JOBS: "RecoveredStaleLeasedJobs",
});

function parseBase64Secret(encodedSecret, envVarName) {
  if (!encodedSecret) {
    throw new Error(`${envVarName} is required`);
  }

  const decoded = Buffer.from(encodedSecret, "base64");
  if (decoded.length !== 32) {
    throw new Error(`${envVarName} must decode to 32 bytes`);
  }

  return decoded;
}

export function requireTelemetryPseudonymKey(env = process.env) {
  return parseBase64Secret(env[TELEMETRY_PSEUDONYM_KEY_ENV], TELEMETRY_PSEUDONYM_KEY_ENV);
}

function resolveEnvironmentName(env = process.env) {
  return env.NODE_ENV || "development";
}

export function hashShopDomain(shopDomain, env = process.env) {
  if (!shopDomain) {
    return null;
  }

  let key;
  try {
    key = requireTelemetryPseudonymKey(env);
  } catch (error) {
    if (resolveEnvironmentName(env) !== "production") {
      return null;
    }

    throw error;
  }

  return crypto
    .createHmac("sha256", key)
    .update(shopDomain)
    .digest("hex");
}

export function hashTelemetryIdentifier(value, env = process.env) {
  if (!value) {
    return null;
  }

  let key;
  try {
    key = requireTelemetryPseudonymKey(env);
  } catch (error) {
    if (resolveEnvironmentName(env) !== "production") {
      return null;
    }

    throw error;
  }

  return crypto
    .createHmac("sha256", key)
    .update(value)
    .digest("hex");
}

function writeLine({ sink = console, payload }) {
  const line = JSON.stringify(payload);
  sink.log?.(line);
  return payload;
}

export function emitEvent({
  event,
  fields = {},
  service,
  severity = "info",
  sink = console,
  timestamp = new Date(),
} = {}) {
  return writeLine({
    payload: {
      event,
      severity,
      service,
      timestamp: timestamp.toISOString(),
      ...fields,
    },
    sink,
  });
}

export function emitMetric({
  dimensions,
  metricName,
  properties = {},
  service,
  sink = console,
  timestamp = new Date(),
  unit = "Count",
  value,
} = {}) {
  const metricDimensions = {
    Environment: properties.Environment ?? resolveEnvironmentName(),
    Service: service,
    ...dimensions,
  };

  return writeLine({
    payload: {
      _aws: {
        CloudWatchMetrics: [
          {
            Dimensions: [Object.keys(metricDimensions)],
            Metrics: [{ Name: metricName, Unit: unit }],
            Namespace: TELEMETRY_NAMESPACE,
          },
        ],
        Timestamp: timestamp.getTime(),
      },
      ...metricDimensions,
      ...properties,
      [metricName]: value,
    },
    sink,
  });
}
