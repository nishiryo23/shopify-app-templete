const DAY_MS = 24 * 60 * 60 * 1000;

export const RAW_TELEMETRY_RETENTION_DAYS = 7;
export const WEBHOOK_PAYLOAD_RETENTION_DAYS = 7;
export const JOB_ATTEMPT_RETENTION_DAYS = 30;

export function addDays(value, days) {
  return new Date(value.getTime() + (days * DAY_MS));
}

/** Domain-specific artifact kinds can map retention here; template default is none. */
export function resolveArtifactRetentionUntil() {
  return null;
}

export function isWebhookPayloadRedactable({ createdAt, now = new Date() }) {
  return addDays(createdAt, WEBHOOK_PAYLOAD_RETENTION_DAYS) <= now;
}

export function buildWebhookPayloadRedactionCutoff(sweepExecutedAt = new Date()) {
  return addDays(sweepExecutedAt, -WEBHOOK_PAYLOAD_RETENTION_DAYS);
}

export function buildJobAttemptRetentionCutoff(now = new Date()) {
  return addDays(now, -JOB_ATTEMPT_RETENTION_DAYS);
}
