import { readFileSync } from "node:fs";
import path from "node:path";

import {
  findLatestRollbackableWriteState,
  findLatestSuccessfulProductWriteArtifact,
  findVerifiedSuccessfulProductWriteArtifactByPreviewJobId,
} from "../../domain/products/write-jobs.mjs";
import {
  buildRollbackInputFromSnapshotRow,
  buildProductUpdateInputFromPreviewRow,
  getWritablePreviewRows,
} from "../../domain/products/write-rows.mjs";
import { buildVariantPriceMutationFromPreviewRow } from "../../domain/variant-prices/write-rows.mjs";
import { buildVariantMutationFromPreviewRow } from "../../domain/variants/write-rows.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

export {
  buildRollbackInputFromSnapshotRow,
  buildProductUpdateInputFromPreviewRow,
  buildVariantMutationFromPreviewRow,
  buildVariantPriceMutationFromPreviewRow,
  findLatestRollbackableWriteState,
  findLatestSuccessfulProductWriteArtifact,
  findVerifiedSuccessfulProductWriteArtifactByPreviewJobId,
  getWritablePreviewRows,
};

export function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

export async function importCollectionProductWriteWorker() {
  return import("../../workers/product-write-collections.mjs");
}

export async function importInventoryProductWriteWorker() {
  return import("../../workers/product-write-inventory.mjs");
}

export async function importMediaProductWriteWorker() {
  return import("../../workers/product-write-media.mjs");
}

export async function importMissingOfflineSessionError() {
  return import("../../workers/offline-admin.mjs");
}

export async function importProductUndoWorker() {
  return import("../../workers/product-undo.mjs");
}

export async function importProductWriteWorker() {
  return import("../../workers/product-write.mjs");
}

export async function importVariantProductWriteWorker() {
  return import("../../workers/product-write-variants.mjs");
}
