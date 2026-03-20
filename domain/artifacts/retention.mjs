import {
  addDays,
  PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS,
  PRODUCT_PREVIEW_EDITED_UPLOAD_RETENTION_DAYS,
  resolveArtifactRetentionUntil,
} from "../retention/policy.mjs";

export {
  addDays,
  resolveArtifactRetentionUntil,
};

export const ARTIFACT_RETENTION_DAYS = Object.freeze({
  "product.preview.edited-upload": PRODUCT_PREVIEW_EDITED_UPLOAD_RETENTION_DAYS,
  "product.export.source": PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS,
  "product.export.manifest": PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS,
  "product.preview.result": PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS,
  "product.write.result": PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS,
  "product.write.snapshot": PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS,
  "product.write.error": PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS,
  "product.undo.result": PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS,
  "product.undo.error": PRODUCT_OPERATION_ARTIFACT_RETENTION_DAYS,
});
