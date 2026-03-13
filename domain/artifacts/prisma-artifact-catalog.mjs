export function createPrismaArtifactCatalog(prisma) {
  return {
    async record({
      bucket,
      contentType,
      jobId = null,
      kind,
      metadata = null,
      objectKey,
      retentionUntil = null,
      shopDomain,
      sizeBytes = null,
      checksumSha256,
      visibility = "private",
    }) {
      return prisma.artifact.upsert({
        where: {
          bucket_objectKey: {
            bucket,
            objectKey,
          },
        },
        update: {
          checksumSha256,
          contentType,
          deletedAt: null,
          jobId,
          kind,
          metadata,
          retentionUntil,
          shopDomain,
          sizeBytes,
          visibility,
        },
        create: {
          bucket,
          checksumSha256,
          contentType,
          jobId,
          kind,
          metadata,
          objectKey,
          retentionUntil,
          shopDomain,
          sizeBytes,
          visibility,
        },
      });
    },

    async markDeleted({ bucket, objectKey, deletedAt = new Date() }) {
      const result = await prisma.artifact.updateMany({
        where: {
          bucket,
          objectKey,
        },
        data: {
          deletedAt,
        },
      });

      return result.count === 1;
    },
  };
}
