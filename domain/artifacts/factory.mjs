import os from "node:os";
import path from "node:path";

import {
  createFilesystemArtifactStorage,
  createS3ArtifactStorage,
} from "./storage.mjs";

export function createArtifactStorageFromEnv({
  env = process.env,
  s3Client,
} = {}) {
  if (env.NODE_ENV === "production") {
    return createS3ArtifactStorage({
      bucket: env.S3_ARTIFACT_BUCKET,
      client: s3Client,
    });
  }

  return createFilesystemArtifactStorage({
    baseDir: path.join(os.tmpdir(), "shopify-app-template-artifacts"),
    bucket: env.S3_ARTIFACT_BUCKET || "local-artifacts",
  });
}
