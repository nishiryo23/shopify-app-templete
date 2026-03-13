export function filterPreviewableExportJobs({ artifacts, jobs }) {
  const previewableJobIds = new Set();
  const artifactKindsByJobId = new Map();

  for (const artifact of artifacts) {
    if (!artifact?.jobId || artifact.deletedAt) {
      continue;
    }

    const kinds = artifactKindsByJobId.get(artifact.jobId) ?? new Set();
    kinds.add(artifact.kind);
    artifactKindsByJobId.set(artifact.jobId, kinds);
  }

  for (const [jobId, kinds] of artifactKindsByJobId.entries()) {
    if (kinds.has("product.export.source") && kinds.has("product.export.manifest")) {
      previewableJobIds.add(jobId);
    }
  }

  return jobs.filter((job) => previewableJobIds.has(job.id));
}
