import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { loadProductPreviewPage } from "~/app/services/product-previews.server";

export const loader = (args: LoaderFunctionArgs) => loadProductPreviewPage(args);

type PreviewLoaderData = {
  exports: Array<{
    createdAt: string;
    id: string;
    profile: string;
  }>;
  preview: null | {
    jobState: string;
    lastError: string | null;
    rows: Array<{
      editedRowNumber: number;
      sourceRowNumber: number | null;
      classification: string;
      productId: string;
      changedFields: string[];
      messages: string[];
    }> | null;
    summary: Record<string, number> | null;
  };
};

export default function PreviewRoute() {
  const data = useLoaderData<typeof loader>() as PreviewLoaderData;
  const createFetcher = useFetcher<{
    error?: string;
    exportJobId: string;
    jobId: string;
    state: string;
  }>();
  const detailFetcher = useFetcher<PreviewLoaderData>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedExportJobId, setSelectedExportJobId] = useState(data.exports[0]?.id ?? "");
  const activePreview = detailFetcher.data?.preview ?? data.preview;
  const activeJobId = createFetcher.data?.jobId ?? searchParams.get("jobId");

  useEffect(() => {
    if (!createFetcher.data?.jobId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("jobId", createFetcher.data.jobId);
    setSearchParams(nextParams, { replace: true });
  }, [createFetcher.data?.jobId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeJobId) {
      return;
    }

    detailFetcher.load(`/app/preview?jobId=${encodeURIComponent(activeJobId)}`);
    if (activePreview?.jobState === "completed" || activePreview?.jobState === "dead_letter") {
      return;
    }

    const timer = setInterval(() => {
      detailFetcher.load(`/app/preview?jobId=${encodeURIComponent(activeJobId)}`);
    }, 1000);

    return () => clearInterval(timer);
  }, [activeJobId, activePreview?.jobState]);

  return (
    <div data-testid="preview-shell">
      <s-page heading="Preview">
        <s-section heading="Upload source and edited CSV">
          <s-paragraph>
            source CSV は未編集の export 原本のみ有効です。選択した export と完全一致しない場合は provenance verify に失敗します。
          </s-paragraph>
          <createFetcher.Form action="/app/product-previews" encType="multipart/form-data" method="post">
            <div style={{ display: "grid", gap: "0.75rem", maxWidth: "42rem" }}>
              <label>
                <span>Completed export</span>
                <select
                  name="exportJobId"
                  onChange={(event) => setSelectedExportJobId(event.currentTarget.value)}
                  value={selectedExportJobId}
                >
                  {data.exports.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.id} ({job.createdAt})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Source CSV</span>
                <input name="sourceFile" required type="file" accept=".csv,text/csv" />
              </label>
              <label>
                <span>Edited CSV</span>
                <input name="editedFile" required type="file" accept=".csv,text/csv" />
              </label>
              <button type="submit">
                {createFetcher.state === "submitting" ? "Uploading..." : "Create preview"}
              </button>
            </div>
          </createFetcher.Form>
          {createFetcher.data?.jobId ? (
            <s-paragraph>Preview job: {createFetcher.data.jobId}</s-paragraph>
          ) : null}
          {createFetcher.data?.error ? (
            <s-paragraph>Request error: {createFetcher.data.error}</s-paragraph>
          ) : null}
        </s-section>
        <s-section heading="Preview status">
          <s-paragraph>
            State: {activePreview?.jobState ?? createFetcher.data?.state ?? "idle"}
          </s-paragraph>
          {activePreview?.lastError ? (
            <s-paragraph>Last error: {activePreview.lastError}</s-paragraph>
          ) : null}
          {activePreview?.summary ? (
            <div data-testid="preview-summary">
              <s-paragraph>Total: {activePreview.summary.total}</s-paragraph>
              <s-paragraph>Changed: {activePreview.summary.changed}</s-paragraph>
              <s-paragraph>Unchanged: {activePreview.summary.unchanged}</s-paragraph>
              <s-paragraph>Warning: {activePreview.summary.warning}</s-paragraph>
              <s-paragraph>Error: {activePreview.summary.error}</s-paragraph>
            </div>
          ) : (
            <s-paragraph>Submit source and edited CSV to generate a preview.</s-paragraph>
          )}
        </s-section>
        <s-section heading="Rows">
          {activePreview?.rows?.length ? (
            <div>
              {activePreview.rows.slice(0, 20).map((row) => (
                <div key={`${row.editedRowNumber}:${row.productId}`} style={{ marginBottom: "0.75rem" }}>
                  <s-paragraph>
                    edited #{row.editedRowNumber} / source #{row.sourceRowNumber ?? "-"} / {row.productId} / {row.classification}
                  </s-paragraph>
                  {row.changedFields.length > 0 ? (
                    <s-paragraph>Changed: {row.changedFields.join(", ")}</s-paragraph>
                  ) : null}
                  {row.messages.map((message) => (
                    <s-paragraph key={message}>{message}</s-paragraph>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <s-paragraph>No preview rows yet.</s-paragraph>
          )}
        </s-section>
      </s-page>
    </div>
  );
}
