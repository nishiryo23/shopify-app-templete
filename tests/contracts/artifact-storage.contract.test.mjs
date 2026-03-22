import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createFilesystemArtifactStorage,
  createMemoryArtifactStorage,
  createS3ArtifactStorage,
} from "../../domain/artifacts/storage.mjs";
import { createPrismaArtifactCatalog } from "../../domain/artifacts/prisma-artifact-catalog.mjs";

test("memory artifact storage is private by default", async () => {
  const storage = createMemoryArtifactStorage();

  const stored = await storage.put({
    body: "hello",
    contentType: "text/plain",
    key: "jobs/job-1/result.txt",
  });

  assert.equal(stored.visibility, "private");
  assert.equal((await storage.get("jobs/job-1/result.txt")).toString("utf8"), "hello");
  assert.equal((await storage.head("jobs/job-1/result.txt")).sizeBytes, 5);
  assert.equal(await storage.delete("jobs/job-1/result.txt"), true);
  assert.equal(await storage.get("jobs/job-1/result.txt"), null);
  assert.equal(await storage.head("jobs/job-1/result.txt"), null);
});

test("filesystem artifact storage rejects public artifacts", async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "artifact-storage-"));
  const storage = createFilesystemArtifactStorage({ baseDir });

  await assert.rejects(
    () =>
      storage.put({
        body: "hello",
        contentType: "text/plain",
        key: "public.txt",
        visibility: "public",
      }),
    /private visibility/,
  );

  await rm(baseDir, { force: true, recursive: true });
});

test("artifact storage rejects traversal-like object keys instead of normalizing them", async () => {
  const storage = createMemoryArtifactStorage();

  await assert.rejects(
    () =>
      storage.put({
        body: "hello",
        contentType: "text/plain",
        key: "../result.csv",
      }),
    /configured storage root/,
  );
});

test("filesystem artifact storage rejects Windows-style traversal keys", async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "artifact-storage-"));
  const storage = createFilesystemArtifactStorage({ baseDir });

  await assert.rejects(
    () =>
      storage.put({
        body: "hello",
        contentType: "text/plain",
        key: "..\\outside.txt",
      }),
    /Windows path separators/,
  );

  await rm(baseDir, { force: true, recursive: true });
});

test("filesystem artifact storage persists binary payloads", async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "artifact-storage-"));
  const storage = createFilesystemArtifactStorage({ baseDir });

  await storage.put({
    body: Buffer.from("artifact"),
    contentType: "application/octet-stream",
    key: "jobs/job-1/result.bin",
  });

  assert.equal((await storage.get("jobs/job-1/result.bin")).toString("utf8"), "artifact");
  await storage.delete("jobs/job-1/result.bin");
  assert.equal(await storage.get("jobs/job-1/result.bin"), null);

  await rm(baseDir, { force: true, recursive: true });
});

test("filesystem artifact storage preserves descriptor metadata on structured reads", async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "artifact-storage-"));
  const storage = createFilesystemArtifactStorage({ baseDir });

  const descriptor = await storage.put({
    body: Buffer.from("artifact"),
    contentType: "text/csv",
    key: "jobs/job-1/result.csv",
    metadata: { source: "preview" },
  });
  const stored = await storage.get(descriptor);

  assert.equal(stored.body.toString("utf8"), "artifact");
  assert.equal(stored.descriptor.contentType, "text/csv");
  assert.deepEqual(stored.descriptor.metadata, { source: "preview" });
  assert.equal(stored.descriptor.key, "jobs/job-1/result.csv");
  assert.equal((await storage.head(descriptor)).sizeBytes, Buffer.byteLength("artifact"));

  await rm(baseDir, { force: true, recursive: true });
});

test("S3 artifact storage preserves descriptor metadata on structured reads", async () => {
  const commands = [];
  const storage = createS3ArtifactStorage({
    bucket: "private-artifacts",
    client: {
      async send(command) {
        commands.push(command);

        if (command.constructor.name === "PutObjectCommand") {
          return {};
        }

        if (command.constructor.name === "GetObjectCommand") {
          return {
            Body: Buffer.from("artifact"),
            ContentType: "text/csv",
            Metadata: {
              codex_metadata_json: JSON.stringify({ source: "export" }),
            },
          };
        }

        if (command.constructor.name === "HeadObjectCommand") {
          return {
            ContentLength: 8,
            ContentType: "text/csv",
            Metadata: {
              codex_metadata_json: JSON.stringify({ source: "export" }),
            },
          };
        }

        return {};
      },
    },
  });

  const descriptor = await storage.put({
    body: Buffer.from("artifact"),
    contentType: "text/csv",
    key: "jobs/job-1/result.csv",
    metadata: { source: "export" },
  });
  const stored = await storage.get(descriptor);

  assert.equal(commands[0].input.Metadata.codex_metadata_json, JSON.stringify({ source: "export" }));
  assert.equal(stored.body.toString("utf8"), "artifact");
  assert.deepEqual(stored.descriptor.metadata, { source: "export" });
  const headed = await storage.head(descriptor);
  assert.equal(commands[2].constructor.name, "HeadObjectCommand");
  assert.equal(headed.sizeBytes, 8);
  assert.deepEqual(headed.metadata, { source: "export" });
});

test("artifact catalog upserts metadata without extending default retention on update", async () => {
  const writes = [];
  const updates = [];
  const catalog = createPrismaArtifactCatalog({
    artifact: {
      async upsert(args) {
        writes.push(args);
        return args.create;
      },
      async updateMany(args) {
        updates.push(args);
        return { count: 1 };
      },
    },
  });

  await catalog.record({
    bucket: "private-artifacts",
    checksumSha256: "abc",
    contentType: "text/csv",
    kind: "product.write.result",
    objectKey: "jobs/job-1/result.csv",
    shopDomain: "example.myshopify.com",
  });
  const deleted = await catalog.markDeleted({
    bucket: "private-artifacts",
    objectKey: "jobs/job-1/result.csv",
    deletedAt: new Date("2026-03-13T00:00:00.000Z"),
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].where.bucket_objectKey.bucket, "private-artifacts");
  assert.equal(writes[0].create.visibility, "private");
  assert.equal(writes[0].create.retentionUntil instanceof Date, true);
  assert.equal("retentionUntil" in writes[0].update, false);
  assert.equal(deleted, true);
  assert.equal(updates[0].where.objectKey, "jobs/job-1/result.csv");
});
