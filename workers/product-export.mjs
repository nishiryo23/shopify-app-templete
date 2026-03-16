import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrismaArtifactCatalog } from "../domain/artifacts/prisma-artifact-catalog.mjs";
import { createProductExportCsvBuilder } from "../domain/products/export-csv.mjs";
import {
  buildProductExportArtifactKey,
  PRODUCT_CORE_SEO_EXPORT_PROFILE,
  PRODUCT_EXPORT_FORMAT,
  PRODUCT_EXPORT_MANIFEST_ARTIFACT_KIND,
  PRODUCT_INVENTORY_EXPORT_PROFILE,
  PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE,
  PRODUCT_METAFIELDS_EXPORT_PROFILE,
  PRODUCT_MEDIA_EXPORT_PROFILE,
  PRODUCT_EXPORT_SOURCE_ARTIFACT_KIND,
  PRODUCT_VARIANT_PRICES_EXPORT_PROFILE,
  PRODUCT_VARIANTS_EXPORT_PROFILE,
} from "../domain/products/export-profile.mjs";
import {
  buildProductSourceFileFromCanonicalCsvPath,
  buildProductSourceBufferFromCanonicalCsv,
  getProductSpreadsheetContentType,
  getProductSpreadsheetFileName,
} from "../domain/products/spreadsheet-format.mjs";
import { requireProvenanceSigningKey } from "../domain/provenance/signing.mjs";
import { readProductPagesForExport } from "../platform/shopify/product-export.server.mjs";
import { readProductVariantPagesForExport } from "../platform/shopify/product-variants.server.mjs";
import { readProductInventoryPagesForExport } from "../platform/shopify/product-inventory.server.mjs";
import { readProductMediaPagesForExport } from "../platform/shopify/product-media.server.mjs";
import { createVariantExportCsvBuilder } from "../domain/variants/export-csv.mjs";
import { createVariantPriceExportCsvBuilder } from "../domain/variant-prices/export-csv.mjs";
import { createInventoryExportCsvBuilder } from "../domain/inventory/export-csv.mjs";
import { createMediaExportCsvBuilder } from "../domain/media/export-csv.mjs";
import { createMetafieldExportCsvBuilder } from "../domain/metafields/export-csv.mjs";
import { createCollectionExportCsvBuilder } from "../domain/collections/export-csv.mjs";
import { readProductMetafieldPagesForExport } from "../platform/shopify/product-metafields.server.mjs";
import { readProductCollectionPagesForExport } from "../platform/shopify/product-collections.server.mjs";
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

export async function runProductExportJob({
  artifactCatalog,
  artifactKeyPrefix = process.env.S3_ARTIFACT_PREFIX,
  artifactStorage,
  assertJobLeaseActive = () => {},
  job,
  now = new Date(),
  prisma,
  readProductPages = readProductPagesForExport,
  readVariantPages = readProductVariantPagesForExport,
  readInventoryPages = readProductInventoryPagesForExport,
  readMediaPages = readProductMediaPagesForExport,
  readMetafieldPages = readProductMetafieldPagesForExport,
  readCollectionPages = readProductCollectionPagesForExport,
  resolveAdminContext = loadOfflineAdminContext,
  signingKey = requireProvenanceSigningKey(),
} = {}) {
  const catalog = artifactCatalog ?? createPrismaArtifactCatalog(prisma);
  const { format = PRODUCT_EXPORT_FORMAT, profile = PRODUCT_CORE_SEO_EXPORT_PROFILE } = job.payload ?? {};

  let sourceDescriptor = null;
  let manifestDescriptor = null;
  let sourceRecord = null;
  let manifestRecord = null;
  let tempDirPath = null;

  try {
    const { admin } = await resolveAdminContext({
      prisma,
      shopDomain: job.shopDomain,
    });
    tempDirPath = await mkdtemp(path.join(os.tmpdir(), "product-export-"));
    const tempCsvPath = path.join(tempDirPath, "source.csv");
    const csvBuilder = profile === PRODUCT_VARIANTS_EXPORT_PROFILE
      ? createVariantExportCsvBuilder({ signingKey })
      : profile === PRODUCT_VARIANT_PRICES_EXPORT_PROFILE
        ? createVariantPriceExportCsvBuilder({ signingKey })
        : profile === PRODUCT_INVENTORY_EXPORT_PROFILE
          ? createInventoryExportCsvBuilder({ signingKey })
          : profile === PRODUCT_METAFIELDS_EXPORT_PROFILE
            ? createMetafieldExportCsvBuilder({ signingKey })
            : profile === PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE
              ? createCollectionExportCsvBuilder({ signingKey })
            : profile === PRODUCT_MEDIA_EXPORT_PROFILE
              ? createMediaExportCsvBuilder({ signingKey })
          : createProductExportCsvBuilder({ signingKey });
    const tempCsvFile = await open(tempCsvPath, "w");

    try {
      const pageIterator = profile === PRODUCT_VARIANTS_EXPORT_PROFILE || profile === PRODUCT_VARIANT_PRICES_EXPORT_PROFILE
        ? readVariantPages(admin, { assertJobLeaseActive })
        : profile === PRODUCT_INVENTORY_EXPORT_PROFILE
          ? readInventoryPages(admin, { assertJobLeaseActive })
          : profile === PRODUCT_METAFIELDS_EXPORT_PROFILE
            ? readMetafieldPages(admin, { assertJobLeaseActive })
            : profile === PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE
              ? readCollectionPages(admin, { assertJobLeaseActive })
            : profile === PRODUCT_MEDIA_EXPORT_PROFILE
              ? readMediaPages(admin, { assertJobLeaseActive })
          : readProductPages(admin, { assertJobLeaseActive });
      for await (const rows of pageIterator) {
        assertJobLeaseActive();
        const csvChunk = profile === PRODUCT_VARIANTS_EXPORT_PROFILE
          ? csvBuilder.appendVariants(rows)
          : profile === PRODUCT_VARIANT_PRICES_EXPORT_PROFILE
            ? csvBuilder.appendVariants(rows)
            : profile === PRODUCT_INVENTORY_EXPORT_PROFILE
              ? csvBuilder.appendVariants(rows)
              : profile === PRODUCT_METAFIELDS_EXPORT_PROFILE
                ? csvBuilder.appendProducts(rows)
              : profile === PRODUCT_MANUAL_COLLECTIONS_EXPORT_PROFILE
                ? csvBuilder.appendProducts(rows)
              : profile === PRODUCT_MEDIA_EXPORT_PROFILE
                ? csvBuilder.appendProducts(rows)
            : csvBuilder.appendProducts(rows);
        if (csvChunk.length > 0) {
          await tempCsvFile.writeFile(csvChunk);
        }
      }
    } finally {
      await tempCsvFile.close();
    }

    const finalized = csvBuilder.finalize();
    const { manifest, metadata: finalizeMetadata = {}, rowCount } = finalized;

    const metadata = {
      fileDigest: manifest.fileDigest,
      format,
      jobId: job.id,
      profile,
      rowCount,
      ...finalizeMetadata,
    };

    assertJobLeaseActive();
    const sourceKey = buildProductExportArtifactKey({
      fileName: getProductSpreadsheetFileName({ format, kind: "source" }),
      jobId: job.id,
      prefix: artifactKeyPrefix,
      shopDomain: job.shopDomain,
    });

    if (format === PRODUCT_EXPORT_FORMAT && artifactStorage.putFile) {
      sourceDescriptor = await artifactStorage.putFile({
        contentType: getProductSpreadsheetContentType(format),
        filePath: tempCsvPath,
        key: sourceKey,
        metadata,
      });
    } else if (format !== PRODUCT_EXPORT_FORMAT && artifactStorage.putFile) {
      const tempSourcePath = path.join(tempDirPath, getProductSpreadsheetFileName({ format, kind: "source" }));
      await buildProductSourceFileFromCanonicalCsvPath({
        csvPath: tempCsvPath,
        format,
        outputPath: tempSourcePath,
        profile,
      });

      sourceDescriptor = await artifactStorage.putFile({
        contentType: getProductSpreadsheetContentType(format),
        filePath: tempSourcePath,
        key: sourceKey,
        metadata,
      });
    } else {
      const canonicalCsvText = await readFile(tempCsvPath, "utf8");
      const sourceBody = await buildProductSourceBufferFromCanonicalCsv({
        canonicalCsvText,
        format,
        profile,
      });

      sourceDescriptor = await artifactStorage.put({
        body: sourceBody,
        contentType: getProductSpreadsheetContentType(format),
        key: sourceKey,
        metadata,
      });
    }

    assertJobLeaseActive();
    manifestDescriptor = await artifactStorage.put({
      body: JSON.stringify(manifest),
      contentType: "application/json",
      key: buildProductExportArtifactKey({
        fileName: "manifest.json",
        jobId: job.id,
        prefix: artifactKeyPrefix,
        shopDomain: job.shopDomain,
      }),
      metadata,
    });

    assertJobLeaseActive();
    sourceRecord = await catalog.record({
      ...sourceDescriptor,
      jobId: job.id,
      kind: PRODUCT_EXPORT_SOURCE_ARTIFACT_KIND,
      metadata,
      retentionUntil: null,
      shopDomain: job.shopDomain,
    });

    assertJobLeaseActive();
    manifestRecord = await catalog.record({
      ...manifestDescriptor,
      contentType: "application/json",
      jobId: job.id,
      kind: PRODUCT_EXPORT_MANIFEST_ARTIFACT_KIND,
      metadata,
      retentionUntil: null,
      shopDomain: job.shopDomain,
    });

    return {
      exportedAt: now.toISOString(),
      fileDigest: manifest.fileDigest,
      format,
      manifestArtifactId: manifestRecord.id,
      profile,
      rowCount,
      sourceArtifactId: sourceRecord.id,
    };
  } catch (error) {
    await Promise.allSettled([
      markDeletedIfPresent(catalog, sourceRecord),
      markDeletedIfPresent(catalog, manifestRecord),
      deleteIfPresent(artifactStorage, sourceDescriptor),
      deleteIfPresent(artifactStorage, manifestDescriptor),
    ]);

    if (error instanceof MissingOfflineSessionError) {
      error.code = "missing-offline-session";
    }

    throw error;
  } finally {
    if (tempDirPath) {
      await rm(tempDirPath, { force: true, recursive: true });
    }
  }
}
