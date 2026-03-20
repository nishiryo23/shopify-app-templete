import test from "node:test";
import assert from "node:assert/strict";

import { importMediaProductWriteWorker } from "./product-write-test-helpers.mjs";

test("media write worker does not delete existing media when replace create returns userErrors", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let deleteCalls = 0;
  const puts = [];

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-1", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-1",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        puts.push(args);
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-1",
      payload: {
        previewArtifactId: "preview-artifact-media-1",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-1",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-1",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/original.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [],
                      mediaUserErrors: [{ field: ["media", "0", "originalSource"], message: "Invalid image URL" }],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            deleteCalls += 1;
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(deleteCalls, 0);
  assert.equal(result.outcome, "verified_failure");
  assert.ok(!("snapshotArtifactId" in result));
  assert.equal(result.rows[0].mutationStatus, "failed");
  assert.match(result.rows[0].messages[0], /Invalid image URL/);
  const resultPut = puts.find((entry) => String(entry.key).endsWith("result.json"));
  assert.ok(resultPut);
  assert.ok(!("snapshotArtifactId" in resultPut.metadata));
});

test("media write worker rolls back newly created media when replace cannot delete the original", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const deleteCalls = [];

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-rollback", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-rollback",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-rollback",
      payload: {
        previewArtifactId: "preview-artifact-media-rollback",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-rollback",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-rollback",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/original.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            deleteCalls.push(variables.mediaIds[0]);
            return {
              ok: true,
              async json() {
                return deleteCalls.length === 1
                  ? {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: [],
                        mediaUserErrors: [{ field: ["mediaIds"], message: "Original delete failed" }],
                      },
                    },
                  }
                  : {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: ["gid://shopify/MediaImage/99"],
                        mediaUserErrors: [],
                      },
                    },
                  };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.deepEqual(deleteCalls, ["gid://shopify/MediaImage/1", "gid://shopify/MediaImage/99"]);
  assert.match(result.rows[0].messages[0], /Original delete failed/);
});

test("media write worker surfaces rollback cleanup errors when compensating delete is rejected", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const deleteCalls = [];

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-rollback-user-errors", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-rollback-user-errors",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-rollback-user-errors",
      payload: {
        previewArtifactId: "preview-artifact-media-rollback-user-errors",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-rollback-user-errors",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-rollback-user-errors",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/original.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            deleteCalls.push(variables.mediaIds[0]);
            return {
              ok: true,
              async json() {
                return deleteCalls.length === 1
                  ? {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: [],
                        mediaUserErrors: [{ field: ["mediaIds"], message: "Original delete failed" }],
                      },
                    },
                  }
                  : {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: [],
                        mediaUserErrors: [{ field: ["mediaIds"], message: "Rollback cleanup failed" }],
                      },
                    },
                  };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.deepEqual(deleteCalls, ["gid://shopify/MediaImage/1", "gid://shopify/MediaImage/99"]);
  assert.match(result.rows[0].messages[0], /Original delete failed/);
  assert.match(result.rows[0].messages[1], /Rollback cleanup failed/);
});

test("media write worker stores revalidation_failed result when live Shopify media source drifted after preview", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let updateCalls = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-race",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_alt"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Updated alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "update",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-race",
      payload: {
        previewArtifactId: "preview-artifact-media-race",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-race",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-race",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/replaced.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductUpdateMedia")) {
            updateCalls += 1;
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productUpdateMedia: {
                      media: [],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(updateCalls, 0);
  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(result.rows[0].verificationStatus, "revalidation_failed");
  assert.match(result.rows[0].messages[0], /changed after preview confirmation was requested/);
});

test("media write worker stores revalidation_failed result when mixed-media set changed after preview", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let createCalls = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            mediaSetByProduct: {
              "gid://shopify/Product/1": [
                {
                  image_alt: "Current alt",
                  image_position: "1",
                  image_src: "https://cdn.shopify.com/original.jpg",
                  media_content_type: "IMAGE",
                  media_id: "gid://shopify/MediaImage/1",
                  product_id: "gid://shopify/Product/1",
                },
                {
                  image_alt: "Clip",
                  image_position: "2",
                  image_src: "https://cdn.shopify.com/video.jpg",
                  media_content_type: "VIDEO",
                  media_id: "gid://shopify/Video/9",
                  product_id: "gid://shopify/Product/1",
                },
              ],
            },
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-mixed-race",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-mixed-race",
      payload: {
        previewArtifactId: "preview-artifact-media-mixed-race",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-mixed-race",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-mixed-race",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      mediaSetByProduct: new Map([
        ["gid://shopify/Product/1", [
          {
            image_alt: "Current alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/original.jpg",
            media_content_type: "IMAGE",
            media_id: "gid://shopify/MediaImage/1",
            product_id: "gid://shopify/Product/1",
          },
          {
            image_alt: "Clip",
            image_position: "2",
            image_src: "https://cdn.shopify.com/video.jpg",
            media_content_type: "VIDEO",
            media_id: "gid://shopify/Video/9",
            product_id: "gid://shopify/Product/1",
          },
          {
            image_alt: "Walkthrough",
            image_position: "3",
            image_src: "https://cdn.shopify.com/new-video.jpg",
            media_content_type: "VIDEO",
            media_id: "gid://shopify/Video/10",
            product_id: "gid://shopify/Product/1",
          },
        ]],
      ]),
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
          image_alt: "Current alt",
          image_position: "1",
          image_src: "https://cdn.shopify.com/original.jpg",
          media_id: "gid://shopify/MediaImage/1",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            createCalls += 1;
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(createCalls, 0);
  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(result.rows[0].verificationStatus, "revalidation_failed");
  assert.match(result.rows[0].messages[0], /changed after preview confirmation was requested/);
});

test("media write worker stores revalidation_failed result when create rows no longer match the live product media set", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let createCalls = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-create-race",
            profile: "product-media-v1",
            rows: [{
              baselineRow: {
                image_alt: "",
                image_position: "",
                image_src: "",
                media_content_type: "IMAGE",
                media_id: "",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                updated_at: "2026-03-15T00:00:00Z",
              },
              changedFields: ["image_src", "image_alt", "image_position"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                image_alt: "Created alt",
                image_position: "1",
                image_src: "https://example.com/new.jpg",
                media_content_type: "IMAGE",
                media_id: "",
                product_handle: "hat",
                product_id: "gid://shopify/Product/1",
                updated_at: "2026-03-15T00:00:00Z",
              },
              editedRowNumber: 2,
              mediaId: null,
              operation: "create",
              productId: "gid://shopify/Product/1",
              sourceRowNumber: 2,
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-create-race",
      payload: {
        previewArtifactId: "preview-artifact-media-create-race",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-create-race",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-create-race",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => ({
      rowsByKey: new Map([
        ["gid://shopify/Product/1\u001egid://shopify/MediaImage/9", {
          image_alt: "Other image",
          image_position: "1",
          image_src: "https://cdn.shopify.com/other.jpg",
          media_id: "gid://shopify/MediaImage/9",
          product_id: "gid://shopify/Product/1",
        }],
      ]),
    }),
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            createCalls += 1;
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(createCalls, 0);
  assert.equal(result.outcome, "revalidation_failed");
  assert.equal(result.rows[0].verificationStatus, "revalidation_failed");
  assert.match(result.rows[0].messages[0], /changed after preview confirmation was requested/);
});

test("media write worker rolls back newly created media when replace delete throws", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const deleteCalls = [];

  await assert.rejects(
    runMediaProductWriteJob({
      artifactCatalog: {
        async record(args) {
          if (args.kind === "product.write.snapshot") {
            return { id: "snapshot-artifact-media-delete-throw", ...args };
          }
          return { id: `${args.kind}-record`, ...args };
        },
      },
      artifactStorage: {
        async get() {
          return {
            body: Buffer.from(JSON.stringify({
              previewDigest: "preview-digest",
              previewJobId: "preview-job-media-delete-throw",
              profile: "product-media-v1",
              rows: [{
                changedFields: ["image_src"],
                classification: "changed",
                currentRow: {
                  image_alt: "Current alt",
                  image_position: "1",
                  image_src: "https://cdn.shopify.com/original.jpg",
                  media_id: "gid://shopify/MediaImage/1",
                  product_id: "gid://shopify/Product/1",
                },
                editedRow: {
                  image_alt: "Current alt",
                  image_position: "1",
                  image_src: "https://example.com/new.jpg",
                },
                editedRowNumber: 2,
                mediaId: "gid://shopify/MediaImage/1",
                operation: "replace",
                productId: "gid://shopify/Product/1",
              }],
              summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
            })),
          };
        },
        async put(args) {
          return {
            bucket: "bucket",
            checksumSha256: "checksum",
            contentType: args.contentType,
            metadata: args.metadata,
            objectKey: args.key,
          };
        },
      },
      job: {
        id: "media-write-job-delete-throw",
        payload: {
          previewArtifactId: "preview-artifact-media-delete-throw",
          previewDigest: "preview-digest",
          previewJobId: "preview-job-media-delete-throw",
          profile: "product-media-v1",
        },
        shopDomain: "example.myshopify.com",
      },
      prisma: {
        artifact: {
          async findFirst() {
            return {
              id: "preview-artifact-media-delete-throw",
              kind: "product.preview.result",
              objectKey: "preview/result.json",
              shopDomain: "example.myshopify.com",
            };
          },
        },
      },
      readLiveMedia: async () => ({
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
            image_alt: "Current alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/original.jpg",
            media_id: "gid://shopify/MediaImage/1",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      }),
      resolveAdminContext: async () => ({
        admin: {
          async graphql(query, { variables } = {}) {
            if (query.includes("mutation ProductCreateMedia")) {
              return {
                ok: true,
                async json() {
                  return {
                    data: {
                      productCreateMedia: {
                        media: [{
                          alt: "Current alt",
                          id: "gid://shopify/MediaImage/99",
                          mediaContentType: "IMAGE",
                          status: "READY",
                        }],
                        mediaUserErrors: [],
                      },
                    },
                  };
                },
              };
            }

            if (query.includes("mutation ProductDeleteMedia")) {
              deleteCalls.push(variables.mediaIds[0]);
              if (deleteCalls.length === 1) {
                throw new Error("delete transport failed");
              }

              return {
                ok: true,
                async json() {
                  return {
                    data: {
                      productDeleteMedia: {
                        deletedMediaIds: ["gid://shopify/MediaImage/99"],
                        mediaUserErrors: [],
                      },
                    },
                  };
                },
              };
            }

            throw new Error(`unexpected GraphQL query: ${query}`);
          },
        },
      }),
    }),
    /delete transport failed/,
  );

  assert.deepEqual(deleteCalls, ["gid://shopify/MediaImage/1", "gid://shopify/MediaImage/99"]);
});

test("media write worker waits for reorder job and reorders newly created media using created media id", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const reorderCalls = [];
  const jobReads = [];
  const sleepCalls = [];
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-2", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-2",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src", "image_position", "image_alt"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                image_alt: "Created alt",
                image_position: "2",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: null,
              operation: "create",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-2",
      payload: {
        previewArtifactId: "preview-artifact-media-2",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-2",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    mediaJobPollIntervalMs: 5,
    mediaJobPollMaxAttempts: 3,
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-2",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return { rowsByKey: new Map() };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Created alt",
            image_position: "2",
            image_src: "https://cdn.shopify.com/new.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    readMediaJob: async (_admin, { jobId }) => {
      jobReads.push(jobId);
      return jobReads.length === 1
        ? { done: false, id: jobId }
        : { done: true, id: jobId };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Created alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "UPLOADED",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            reorderCalls.push(variables.moves);
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: { done: false, id: "gid://shopify/Job/1" },
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
    sleep: async (milliseconds) => {
      sleepCalls.push(milliseconds);
    },
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].mediaId, "gid://shopify/MediaImage/99");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.deepEqual(reorderCalls, [[{ id: "gid://shopify/MediaImage/99", newPosition: 1 }]]);
  assert.deepEqual(jobReads, ["gid://shopify/Job/1", "gid://shopify/Job/1"]);
  assert.deepEqual(sleepCalls, [5]);
});

test("media write worker fails verification when created media alt does not match expected blank alt", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-create-alt", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-create-alt",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src", "image_position"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                image_alt: "",
                image_position: "2",
                image_src: "https://example.com/new.jpg",
              },
              editedRowNumber: 2,
              mediaId: null,
              operation: "create",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-create-alt",
      payload: {
        previewArtifactId: "preview-artifact-media-create-alt",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-create-alt",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-create-alt",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return { rowsByKey: new Map() };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Unexpected alt",
            image_position: "2",
            image_src: "https://cdn.shopify.com/new.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.equal(result.rows[0].verificationStatus, "failed");
  assert.match(result.rows[0].messages.at(-1), /Final-state verification failed/);
  assert.equal(liveReadCount, 2);
});

test("media write worker polls until uploaded created media becomes visible before final verification", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const sleepCalls = [];
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-3", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-3",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src", "image_alt"],
              classification: "changed",
              currentRow: null,
              editedRow: {
                image_alt: "Created alt",
                image_position: "",
                image_src: "https://example.com/slow.jpg",
              },
              editedRowNumber: 2,
              mediaId: null,
              operation: "create",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-3",
      payload: {
        previewArtifactId: "preview-artifact-media-3",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-3",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    mediaCreatePollIntervalMs: 5,
    mediaCreatePollMaxAttempts: 3,
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-3",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount < 3) {
        return { rowsByKey: new Map() };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/123", {
            image_alt: "Created alt",
            image_position: "",
            image_src: "https://cdn.shopify.com/slow.jpg",
            media_id: "gid://shopify/MediaImage/123",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Created alt",
                        id: "gid://shopify/MediaImage/123",
                        mediaContentType: "IMAGE",
                        status: "UPLOADED",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
    sleep: async (milliseconds) => {
      sleepCalls.push(milliseconds);
    },
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.equal(liveReadCount, 3);
  assert.deepEqual(sleepCalls, [5]);
});

test("media write worker re-reads live media for final verification when no create polling is needed", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-4", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-4",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_alt"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Updated alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "update",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-4",
      payload: {
        previewArtifactId: "preview-artifact-media-4",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-4",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-4",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "1",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
            image_alt: "Updated alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/original.jpg",
            media_id: "gid://shopify/MediaImage/1",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductUpdateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productUpdateMedia: {
                      media: [{
                        alt: "Updated alt",
                        id: "gid://shopify/MediaImage/1",
                        mediaContentType: "IMAGE",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.equal(liveReadCount, 2);
});

test("media write worker skips productUpdateMedia for position-only edits and still reorders", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const reorderCalls = [];
  let updateCalls = 0;
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-position-only", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-position-only",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_position"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "2",
                image_src: "https://cdn.shopify.com/original.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "update",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-position-only",
      payload: {
        previewArtifactId: "preview-artifact-media-position-only",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-position-only",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-position-only",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "1",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
            image_alt: "Current alt",
            image_position: "2",
            image_src: "https://cdn.shopify.com/original.jpg",
            media_id: "gid://shopify/MediaImage/1",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductUpdateMedia")) {
            updateCalls += 1;
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productUpdateMedia: {
                      media: [],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            reorderCalls.push(variables.moves);
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(updateCalls, 0);
  assert.deepEqual(reorderCalls, [[{ id: "gid://shopify/MediaImage/1", newPosition: 1 }]]);
  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
});

test("media write worker reorders replace rows even when image_position was not edited", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const reorderCalls = [];
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-5", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-5",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "1",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-5",
      payload: {
        previewArtifactId: "preview-artifact-media-5",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-5",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-5",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "1",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Current alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/replacement.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            reorderCalls.push(variables.moves);
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.deepEqual(reorderCalls, [[{ id: "gid://shopify/MediaImage/99", newPosition: 0 }]]);
  assert.equal(liveReadCount, 2);
});

test("media write worker fails verification when replace row keeps wrong alt despite source-only edit", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-replace-alt", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-replace-alt",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Expected alt",
                image_position: "1",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Expected alt",
                image_position: "1",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-replace-alt",
      payload: {
        previewArtifactId: "preview-artifact-media-replace-alt",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-replace-alt",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-replace-alt",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Expected alt",
              image_position: "1",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Wrong alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/replacement.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Expected alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.equal(result.rows[0].verificationStatus, "failed");
  assert.match(result.rows[0].messages.at(-1), /Final-state verification failed/);
  assert.equal(liveReadCount, 2);
});

test("media write worker preserves original order for replace rows when image_position is blank", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  const reorderCalls = [];
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-6", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-6",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "2",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-6",
      payload: {
        previewArtifactId: "preview-artifact-media-6",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-6",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-6",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async () => {
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "2",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Current alt",
            image_position: "2",
            image_src: "https://cdn.shopify.com/replacement.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query, { variables } = {}) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            reorderCalls.push(variables.moves);
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_success");
  assert.equal(result.rows[0].verificationStatus, "verified");
  assert.deepEqual(reorderCalls, [[{ id: "gid://shopify/MediaImage/99", newPosition: 1 }]]);
  assert.equal(liveReadCount, 2);
});

test("media write worker fails verification when replace row with blank image_position lands in wrong slot", async () => {
  const { runMediaProductWriteJob } = await importMediaProductWriteWorker();
  let liveReadCount = 0;

  const result = await runMediaProductWriteJob({
    artifactCatalog: {
      async record(args) {
        if (args.kind === "product.write.snapshot") {
          return { id: "snapshot-artifact-media-7", ...args };
        }
        return { id: `${args.kind}-record`, ...args };
      },
    },
    artifactStorage: {
      async get() {
        return {
          body: Buffer.from(JSON.stringify({
            previewDigest: "preview-digest",
            previewJobId: "preview-job-media-7",
            profile: "product-media-v1",
            rows: [{
              changedFields: ["image_src"],
              classification: "changed",
              currentRow: {
                image_alt: "Current alt",
                image_position: "2",
                image_src: "https://cdn.shopify.com/original.jpg",
                media_id: "gid://shopify/MediaImage/1",
                product_id: "gid://shopify/Product/1",
              },
              editedRow: {
                image_alt: "Current alt",
                image_position: "",
                image_src: "https://example.com/replacement.jpg",
              },
              editedRowNumber: 2,
              mediaId: "gid://shopify/MediaImage/1",
              operation: "replace",
              productId: "gid://shopify/Product/1",
            }],
            summary: { changed: 1, error: 0, total: 1, unchanged: 0, warning: 0 },
          })),
        };
      },
      async put(args) {
        return {
          bucket: "bucket",
          checksumSha256: "checksum",
          contentType: args.contentType,
          metadata: args.metadata,
          objectKey: args.key,
        };
      },
    },
    job: {
      id: "media-write-job-7",
      payload: {
        previewArtifactId: "preview-artifact-media-7",
        previewDigest: "preview-digest",
        previewJobId: "preview-job-media-7",
        profile: "product-media-v1",
      },
      shopDomain: "example.myshopify.com",
    },
    prisma: {
      artifact: {
        async findFirst() {
          return {
            id: "preview-artifact-media-7",
            kind: "product.preview.result",
            objectKey: "preview/result.json",
            shopDomain: "example.myshopify.com",
          };
        },
      },
    },
    readLiveMedia: async (_admin, _productIds, { assertJobLeaseActive } = {}) => {
      assertJobLeaseActive?.();
      liveReadCount += 1;
      if (liveReadCount === 1) {
        return {
          rowsByKey: new Map([
            ["gid://shopify/Product/1\u001egid://shopify/MediaImage/1", {
              image_alt: "Current alt",
              image_position: "2",
              image_src: "https://cdn.shopify.com/original.jpg",
              media_id: "gid://shopify/MediaImage/1",
              product_id: "gid://shopify/Product/1",
            }],
          ]),
        };
      }

      return {
        rowsByKey: new Map([
          ["gid://shopify/Product/1\u001egid://shopify/MediaImage/99", {
            image_alt: "Current alt",
            image_position: "1",
            image_src: "https://cdn.shopify.com/replacement.jpg",
            media_id: "gid://shopify/MediaImage/99",
            product_id: "gid://shopify/Product/1",
          }],
        ]),
      };
    },
    resolveAdminContext: async () => ({
      admin: {
        async graphql(query) {
          if (query.includes("mutation ProductCreateMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productCreateMedia: {
                      media: [{
                        alt: "Current alt",
                        id: "gid://shopify/MediaImage/99",
                        mediaContentType: "IMAGE",
                        status: "READY",
                      }],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductDeleteMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productDeleteMedia: {
                      deletedMediaIds: ["gid://shopify/MediaImage/1"],
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          if (query.includes("mutation ProductReorderMedia")) {
            return {
              ok: true,
              async json() {
                return {
                  data: {
                    productReorderMedia: {
                      job: null,
                      mediaUserErrors: [],
                    },
                  },
                };
              },
            };
          }

          throw new Error(`unexpected GraphQL query: ${query}`);
        },
      },
    }),
  });

  assert.equal(result.outcome, "verified_failure");
  assert.equal(result.rows[0].verificationStatus, "failed");
  assert.match(result.rows[0].messages.at(-1), /Final-state verification failed/);
  assert.equal(liveReadCount, 2);
});
