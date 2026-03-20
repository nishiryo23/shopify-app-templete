import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("preview confirm guard uses the same verified-write truth as the write action", () => {
  const previewService = readProjectFile("app/services/product-previews.server.ts");
  const previewRoute = readProjectFile("app/routes/app.preview.tsx");
  const writeService = readProjectFile("app/services/product-writes.server.ts");

  assert.match(
    previewService,
    /selectedPreviewVerifiedWrite: await loadSelectedPreviewVerifiedWrite\(\{\s+previewJobId,\s+profile,\s+shopDomain,\s+\}\)/m,
  );
  assert.match(
    previewService,
    /findVerifiedSuccessfulProductWriteArtifactByPreviewJobId\(\{\s+previewJobId,\s+prisma,\s+profile,\s+shopDomain,\s+\}\)/m,
  );
  assert.match(
    writeService,
    /const existingVerifiedSuccess = await findVerifiedSuccessfulProductWriteArtifactByPreviewJobId\(\{\s+previewJobId,\s+prisma,\s+profile,\s+shopDomain,\s+\}\)/m,
  );
  assert.match(
    previewRoute,
    /const previewAlreadyHasVerifiedWrite = Boolean\(selectedPreviewVerifiedWrite\?\.writeJobId\);/m,
  );
  assert.match(
    previewRoute,
    /const canConfirm = data\.isAccountOwner[\s\S]*&& !previewAlreadyHasVerifiedWrite;/m,
  );
});
