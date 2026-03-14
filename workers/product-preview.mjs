import { createPrismaArtifactCatalog } from "../domain/artifacts/prisma-artifact-catalog.mjs";
import { buildPreviewDigest, buildPreviewRows, indexRowsByProductId, parseProductPreviewCsv } from "../domain/products/preview-csv.mjs";
import {
  PRODUCT_VARIANTS_EXPORT_PROFILE,
} from "../domain/products/export-profile.mjs";
import {
  buildProductPreviewArtifactKey,
  PRODUCT_PREVIEW_RESULT_ARTIFACT_KIND,
} from "../domain/products/preview-profile.mjs";
import { verifyCsvManifest } from "../domain/provenance/csv-manifest.mjs";
import { requireProvenanceSigningKey, sha256Hex } from "../domain/provenance/signing.mjs";
import { readProductsForPreview } from "../platform/shopify/product-preview.server.mjs";
import { buildVariantPreviewDigest, buildVariantPreviewRows, indexVariantRows, parseVariantPreviewCsv } from "../domain/variants/preview-csv.mjs";
import { readVariantsForProducts } from "../platform/shopify/product-variants.server.mjs";
import { MissingOfflineSessionError, loadOfflineAdminContext } from "./offline-admin.mjs";

async function deleteIfPresent(storage, descriptor) {
  if (descriptor?.objectKey) {
    await storage.delete(descriptor);
  }
}

async function markDeletedIfPresent(catalog, descriptor) {
  if (descriptor?.bucket && descriptor?.objectKey) {
    await catalog.markDeleted({
      bucket: descriptor.bucket,
      objectKey: descriptor.objectKey,
    });
  }
}

async function loadArtifactRecordOrThrow(prisma, { artifactId, kind, shopDomain }) {
  const artifact = await prisma.artifact.findFirst({
    where: {
      deletedAt: null,
      id: artifactId,
      kind,
      shopDomain,
    },
  });

  if (!artifact) {
    throw new Error(`missing-artifact:${kind}`);
  }

  return artifact;
}

export async function runProductPreviewJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  job,
  prisma,
  readLiveProducts = readProductsForPreview,
  readLiveVariants = readVariantsForProducts,
  resolveAdminContext = loadOfflineAdminContext,
  signingKey = requireProvenanceSigningKey(),
} = {}) {
  const catalog = artifactCatalog ?? createPrismaArtifactCatalog(prisma);
  let resultDescriptor = null;
  let resultRecord = null;

  try {
    const payload = job.payload ?? {};
    const editedUploadArtifact = await loadArtifactRecordOrThrow(prisma, {
      artifactId: payload.editedUploadArtifactId,
      kind: "product.preview.edited-upload",
      shopDomain: job.shopDomain,
    });
    const manifestArtifact = await loadArtifactRecordOrThrow(prisma, {
      artifactId: payload.manifestArtifactId,
      kind: "product.export.manifest",
      shopDomain: job.shopDomain,
    });
    const sourceArtifact = await loadArtifactRecordOrThrow(prisma, {
      artifactId: payload.sourceArtifactId,
      kind: "product.export.source",
      shopDomain: job.shopDomain,
    });

    const [editedRecord, manifestRecord, sourceRecord] = await Promise.all([
      artifactStorage.get(editedUploadArtifact.objectKey),
      artifactStorage.get(manifestArtifact.objectKey),
      artifactStorage.get(sourceArtifact.objectKey),
    ]);

    const editedBody = Buffer.isBuffer(editedRecord) ? editedRecord : editedRecord?.body;
    const manifestBody = Buffer.isBuffer(manifestRecord) ? manifestRecord : manifestRecord?.body;
    const sourceBody = Buffer.isBuffer(sourceRecord) ? sourceRecord : sourceRecord?.body;

    if (!editedBody || !manifestBody || !sourceBody) {
      throw new Error("missing-preview-artifact-body");
    }

    const sourceCsvText = sourceBody.toString("utf8");
    const editedCsvText = editedBody.toString("utf8");
    const manifest = JSON.parse(manifestBody.toString("utf8"));
    const sourceVerification = verifyCsvManifest({
      csvText: sourceCsvText,
      manifest,
      signingKey,
    });

    if (!sourceVerification.ok) {
      throw new Error(sourceVerification.reason);
    }

    const { admin } = await resolveAdminContext({
      prisma,
      shopDomain: job.shopDomain,
    });
    let rows;
    let summary;

    assertJobLeaseActive();
    if (payload.profile === PRODUCT_VARIANTS_EXPORT_PROFILE) {
      const baselineRows = parseVariantPreviewCsv(sourceCsvText);
      const editedRows = parseVariantPreviewCsv(editedCsvText);
      const { productIds: baselineProductIds, rowsByKey: editedRowsByKey } = indexVariantRows(editedRows);
      const { rowsByKey: baselineRowsByKey } = indexVariantRows(baselineRows);
      const baselineRowsByVariantId = new Map();
      for (const entry of baselineRowsByKey.values()) {
        if (entry.row.variant_id) {
          baselineRowsByVariantId.set(entry.row.variant_id, entry);
        }
      }
      const {
        productsById: currentProductsById,
        variantsByProductId: currentVariantsByProductId,
      } = await readLiveVariants(
        admin,
        [...baselineProductIds],
        { assertJobLeaseActive },
      );
      const preview = buildVariantPreviewRows({
        baselineProductIds: new Set(baselineRows.map((entry) => entry.row.product_id).filter(Boolean)),
        baselineRowsByVariantId,
        currentProductsById,
        currentVariantsByProductId,
        editedRows: [...editedRowsByKey.values()],
      });
      rows = preview.rows;
      summary = preview.summary;
    } else {
      const baselineRows = parseProductPreviewCsv(sourceCsvText);
      const editedRows = parseProductPreviewCsv(editedCsvText);
      const baselineRowsByProductId = indexRowsByProductId(baselineRows);
      indexRowsByProductId(editedRows);
      const currentRowsByProductId = await readLiveProducts(
        admin,
        editedRows.map((entry) => entry.row.product_id).filter(Boolean),
        { assertJobLeaseActive },
      );

      const preview = buildPreviewRows({
        baselineRowsByProductId,
        currentRowsByProductId,
        editedRows,
      });
      rows = preview.rows;
      summary = preview.summary;
    }

    const baselineDigest = sha256Hex(sourceCsvText);
    const editedDigest = sha256Hex(editedCsvText);
    const previewDigest = payload.profile === PRODUCT_VARIANTS_EXPORT_PROFILE
      ? buildVariantPreviewDigest({
        baselineDigest,
        editedDigest,
        exportJobId: payload.exportJobId,
        profile: payload.profile,
        rows,
        summary,
      })
      : buildPreviewDigest({
        baselineDigest,
        editedDigest,
        exportJobId: payload.exportJobId,
        profile: payload.profile,
        rows,
        summary,
      });

    const resultPayload = {
      baselineDigest,
      editedDigest,
      editedUploadArtifactId: payload.editedUploadArtifactId,
      exportJobId: payload.exportJobId,
      manifestArtifactId: payload.manifestArtifactId,
      previewDigest,
      profile: payload.profile,
      rows,
      sourceArtifactId: payload.sourceArtifactId,
      summary,
    };

    const metadata = {
      baselineDigest,
      changed: summary.changed,
      editedDigest,
      error: summary.error,
      exportJobId: payload.exportJobId,
      previewDigest,
      profile: payload.profile,
      total: summary.total,
      unchanged: summary.unchanged,
      warning: summary.warning,
    };

    assertJobLeaseActive();
    resultDescriptor = await artifactStorage.put({
      body: JSON.stringify(resultPayload),
      contentType: "application/json",
      key: buildProductPreviewArtifactKey({
        fileName: "result.json",
        jobId: job.id,
        prefix: artifactKeyPrefix,
        shopDomain: job.shopDomain,
      }),
      metadata,
    });

    assertJobLeaseActive();
    resultRecord = await catalog.record({
      ...resultDescriptor,
      jobId: job.id,
      kind: PRODUCT_PREVIEW_RESULT_ARTIFACT_KIND,
      metadata,
      retentionUntil: null,
      shopDomain: job.shopDomain,
    });

    return {
      previewArtifactId: resultRecord.id,
      previewDigest,
      summary,
    };
  } catch (error) {
    await Promise.allSettled([
      markDeletedIfPresent(catalog, resultRecord),
      deleteIfPresent(artifactStorage, resultDescriptor),
    ]);

    if (error instanceof MissingOfflineSessionError) {
      error.code = "missing-offline-session";
    }

    throw error;
  }
}
