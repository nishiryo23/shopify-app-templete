const DAY_MS = 24 * 60 * 60 * 1000;

export const RAW_TELEMETRY_RETENTION_DAYS = 7;
export const WEBHOOK_PAYLOAD_RETENTION_DAYS = 7;
export const PRODUCT_PREVIEW_EDITED_UPLOAD_RETENTION_DAYS = 7;
export const PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS = 90;
export const JOB_ATTEMPT_RETENTION_DAYS = 30;

const EDITED_UPLOAD_KINDS = new Set(["product.preview.edited-upload"]);
const PRODUCT_OPERATION_ARTIFACT_KINDS = new Set([
  "product.export.source",
  "product.export.manifest",
  "product.preview.result",
  "product.write.result",
  "product.write.snapshot",
  "product.write.error",
  "product.undo.result",
  "product.undo.error",
]);

export function addDays(value, days) {
  return new Date(value.getTime() + (days * DAY_MS));
}

export function resolveArtifactRetentionUntil({ kind, now = new Date() }) {
  if (EDITED_UPLOAD_KINDS.has(kind)) {
    return addDays(now, PRODUCT_PREVIEW_EDITED_UPLOAD_RETENTION_DAYS);
  }

  if (PRODUCT_OPERATION_ARTIFACT_KINDS.has(kind)) {
    return addDays(now, PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS);
  }

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
