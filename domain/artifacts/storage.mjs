import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256Hex } from "../provenance/signing.mjs";

// Artifacts must remain private by default.
function assertPrivateVisibility(visibility) {
  if (visibility && visibility !== "private") {
    throw new Error("artifact storage only supports private visibility");
  }
}

function toBuffer(body) {
  return Buffer.isBuffer(body) ? body : Buffer.from(body);
}

function normalizeObjectKey(objectKey) {
  if (objectKey.includes("\\")) {
    throw new Error("Artifact objectKey must not contain Windows path separators");
  }

  const normalized = path.posix.normalize(objectKey);

  if (
    !normalized ||
    normalized === "." ||
    normalized !== objectKey ||
    normalized.startsWith("/") ||
    normalized.includes("../")
  ) {
    throw new Error("Artifact objectKey must stay within the configured storage root");
  }

  return normalized;
}

function resolveFilesystemPath(rootDir, objectKey) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRootDir, objectKey);
  const relativePath = path.relative(resolvedRootDir, resolvedPath);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return resolvedPath;
  }

  throw new Error("Artifact objectKey must stay within the configured storage root");
}

function resolveObjectKey(value) {
  if (typeof value === "string") {
    return normalizeObjectKey(value);
  }

  return normalizeObjectKey(value.objectKey ?? value.key);
}

function buildDescriptor({ body, bucket, contentType, metadata = null, objectKey }) {
  return {
    bucket,
    checksumSha256: sha256Hex(body),
    contentType,
    key: objectKey,
    metadata,
    objectKey,
    sizeBytes: body.byteLength,
    visibility: "private",
  };
}

export function createMemoryArtifactStorage({ bucket = "memory-artifacts" } = {}) {
  const objects = new Map();

  return {
    async put({ body, contentType = "application/octet-stream", key, metadata = null, objectKey, visibility = "private" }) {
      assertPrivateVisibility(visibility);
      const normalizedBody = toBuffer(body);
      const normalizedObjectKey = resolveObjectKey({ key, objectKey });
      const descriptor = buildDescriptor({
        body: normalizedBody,
        bucket,
        contentType,
        metadata,
        objectKey: normalizedObjectKey,
      });

      objects.set(normalizedObjectKey, {
        body: normalizedBody,
        descriptor,
      });

      return descriptor;
    },

    async get(key) {
      const record = objects.get(resolveObjectKey(key)) ?? null;
      return typeof key === "string" ? record?.body ?? null : record;
    },

    async delete(key) {
      return objects.delete(resolveObjectKey(key));
    },
  };
}

export function createFilesystemArtifactStorage({ baseDir, bucket = "local-artifacts", rootDir } = {}) {
  const resolvedRootDir = rootDir ?? baseDir;
  const descriptors = new Map();

  if (!resolvedRootDir) {
    throw new Error("baseDir or rootDir is required for filesystem artifact storage");
  }

  return {
    async put({ body, contentType = "application/octet-stream", key, metadata = null, objectKey, visibility = "private" }) {
      assertPrivateVisibility(visibility);
      const normalizedBody = toBuffer(body);
      const normalizedObjectKey = resolveObjectKey({ key, objectKey });

      // Artifact objectKey must stay within the configured storage root.
      const filePath = resolveFilesystemPath(resolvedRootDir, normalizedObjectKey);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, normalizedBody);

      const descriptor = buildDescriptor({
        body: normalizedBody,
        bucket,
        contentType,
        metadata,
        objectKey: normalizedObjectKey,
      });

      descriptors.set(normalizedObjectKey, descriptor);
      return descriptor;
    },

    async get(key) {
      const normalizedObjectKey = resolveObjectKey(key);
      const filePath = resolveFilesystemPath(resolvedRootDir, normalizedObjectKey);

      try {
        const body = await readFile(filePath);

        if (typeof key === "string") {
          return body;
        }

        const fileStats = await stat(filePath);
        const storedDescriptor = descriptors.get(normalizedObjectKey);
        return {
          body,
          descriptor: {
            bucket: storedDescriptor?.bucket ?? bucket,
            checksumSha256: sha256Hex(body),
            contentType: storedDescriptor?.contentType ?? "application/octet-stream",
            key: normalizedObjectKey,
            metadata: storedDescriptor?.metadata ?? null,
            objectKey: normalizedObjectKey,
            sizeBytes: fileStats.size,
            visibility: "private",
          },
        };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return null;
        }

        throw error;
      }
    },

    async delete(key) {
      const normalizedObjectKey = resolveObjectKey(key);
      await rm(resolveFilesystemPath(resolvedRootDir, normalizedObjectKey), { force: true });
      descriptors.delete(normalizedObjectKey);
      return true;
    },
  };
}
