UPDATE "Artifact"
SET "retentionUntil" = CASE
  WHEN "kind" = 'product.preview.edited-upload' THEN "createdAt" + INTERVAL '7 days'
  WHEN "kind" IN (
    'product.export.source',
    'product.export.manifest',
    'product.preview.result',
    'product.write.result',
    'product.write.snapshot',
    'product.write.error',
    'product.undo.result',
    'product.undo.error'
  ) THEN "createdAt" + INTERVAL '90 days'
  ELSE "retentionUntil"
END
WHERE "retentionUntil" IS NULL
  AND "kind" IN (
    'product.preview.edited-upload',
    'product.export.source',
    'product.export.manifest',
    'product.preview.result',
    'product.write.result',
    'product.write.snapshot',
    'product.write.error',
    'product.undo.result',
    'product.undo.error'
  );
