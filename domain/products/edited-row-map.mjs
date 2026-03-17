import { sha256Hex } from "../provenance/signing.mjs";

export function buildEditedRowMap(editedRowNumbers = []) {
  return editedRowNumbers.map((editedRowNumber, index) => ({
    canonicalRowNumber: index + 2,
    editedRowNumber,
  }));
}

export function buildEditedRowMapDigest(editedRowNumbers = []) {
  return sha256Hex(JSON.stringify(buildEditedRowMap(editedRowNumbers)));
}

export function buildIdentityEditedRowNumbers(rowCount = 0) {
  return Array.from({ length: Math.max(Number(rowCount) || 0, 0) }, (_, index) => index + 2);
}
