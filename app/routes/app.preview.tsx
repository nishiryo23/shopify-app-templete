import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { loadProductPreviewPage } from "~/app/services/product-previews.server";

export const loader = (args: LoaderFunctionArgs) => loadProductPreviewPage(args);

type PreviewLoaderData = {
  entitlementState: string;
  exports: Array<{
    createdAt: string;
    id: string;
    profile: string;
  }>;
  isAccountOwner: boolean;
  latestWrite: null | {
    outcome: string | null;
    previewJobId: string | null;
    total: number | null;
    writeJobId: string | null;
  };
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
  undo: null | {
    jobState: string;
    lastError: string | null;
    outcome: string | null;
    summary: Record<string, number> | null;
    undoJobId: string;
  };
  write: null | {
    jobState: string;
    lastError: string | null;
    outcome: string | null;
    summary: Record<string, number> | null;
    writeJobId: string;
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
  const writeFetcher = useFetcher<{
    error?: string;
    jobId: string;
    previewJobId: string;
    state: string;
  }>();
  const undoFetcher = useFetcher<{
    error?: string;
    jobId: string;
    state: string;
    writeJobId: string;
  }>();
  const detailFetcher = useFetcher<PreviewLoaderData>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedExportJobId, setSelectedExportJobId] = useState(data.exports[0]?.id ?? "");
  const latestWrite = detailFetcher.data?.latestWrite ?? data.latestWrite;
  const activePreview = detailFetcher.data?.preview ?? data.preview;
  const activeWrite = detailFetcher.data?.write ?? data.write;
  const activeUndo = detailFetcher.data?.undo ?? data.undo;
  const activePreviewJobId = createFetcher.data?.jobId ?? searchParams.get("previewJobId") ?? searchParams.get("jobId");
  const activeWriteJobId = writeFetcher.data?.jobId ?? searchParams.get("writeJobId");
  const activeUndoJobId = undoFetcher.data?.jobId ?? searchParams.get("undoJobId");
  const previewHasWritableRows = Boolean(activePreview?.rows?.some((row) => row.changedFields.length > 0));
  const latestWriteMatchesPreview = Boolean(
    latestWrite?.outcome === "verified_success"
      && latestWrite.previewJobId
      && latestWrite.previewJobId === activePreviewJobId,
  );
  const canConfirm = data.isAccountOwner
    && data.entitlementState === "ACTIVE_PAID"
    && activePreview?.jobState === "completed"
    && previewHasWritableRows
    && !latestWriteMatchesPreview;
  const canUndo = data.isAccountOwner
    && data.entitlementState === "ACTIVE_PAID"
    && Boolean(latestWrite?.writeJobId);

  useEffect(() => {
    if (!createFetcher.data?.jobId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("previewJobId", createFetcher.data.jobId);
    nextParams.delete("jobId");
    setSearchParams(nextParams, { replace: true });
  }, [createFetcher.data?.jobId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!writeFetcher.data?.jobId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("writeJobId", writeFetcher.data.jobId);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, writeFetcher.data?.jobId]);

  useEffect(() => {
    if (!undoFetcher.data?.jobId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("undoJobId", undoFetcher.data.jobId);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, undoFetcher.data?.jobId]);

  useEffect(() => {
    if (!activePreviewJobId && !activeWriteJobId && !activeUndoJobId) {
      return;
    }

    const params = new URLSearchParams();
    if (activePreviewJobId) {
      params.set("previewJobId", activePreviewJobId);
    }
    if (activeWriteJobId) {
      params.set("writeJobId", activeWriteJobId);
    }
    if (activeUndoJobId) {
      params.set("undoJobId", activeUndoJobId);
    }

    const load = () => detailFetcher.load(`/app/preview?${params.toString()}`);
    load();

    const isPreviewTerminal = !activePreview || activePreview.jobState === "completed" || activePreview.jobState === "dead_letter";
    const isWriteTerminal = !activeWrite || activeWrite.jobState === "completed" || activeWrite.jobState === "dead_letter";
    const isUndoTerminal = !activeUndo || activeUndo.jobState === "completed" || activeUndo.jobState === "dead_letter";

    if (isPreviewTerminal && isWriteTerminal && isUndoTerminal) {
      return;
    }

    const timer = setInterval(load, 1000);

    return () => clearInterval(timer);
  }, [
    activePreview?.jobState,
    activePreviewJobId,
    activeUndo?.jobState,
    activeUndoJobId,
    activeWrite?.jobState,
    activeWriteJobId,
  ]);

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
        <s-section heading="Write">
          <s-paragraph>Entitlement: {data.entitlementState}</s-paragraph>
          <s-paragraph>Owner: {data.isAccountOwner ? "yes" : "no"}</s-paragraph>
          <writeFetcher.Form action="/app/product-writes" method="post">
            <input name="previewJobId" type="hidden" value={activePreviewJobId ?? ""} />
            <button disabled={!canConfirm} type="submit">
              {writeFetcher.state === "submitting" ? "Confirming..." : "Confirm and write"}
            </button>
          </writeFetcher.Form>
          {!previewHasWritableRows && activePreview?.jobState === "completed" ? (
            <s-paragraph>No writable rows in this preview.</s-paragraph>
          ) : null}
          {!data.isAccountOwner ? (
            <s-paragraph>Only the shop owner can confirm writes.</s-paragraph>
          ) : null}
          {data.entitlementState !== "ACTIVE_PAID" ? (
            <s-paragraph>ACTIVE_PAID entitlement is required for write and undo.</s-paragraph>
          ) : null}
          {latestWriteMatchesPreview ? (
            <s-paragraph>This preview already has a verified successful write.</s-paragraph>
          ) : null}
          {writeFetcher.data?.error ? (
            <s-paragraph>Write error: {writeFetcher.data.error}</s-paragraph>
          ) : null}
          <s-paragraph>State: {activeWrite?.jobState ?? writeFetcher.data?.state ?? "idle"}</s-paragraph>
          {activeWrite?.outcome ? (
            <s-paragraph>Outcome: {activeWrite.outcome}</s-paragraph>
          ) : null}
          {activeWrite?.lastError ? (
            <s-paragraph>Last error: {activeWrite.lastError}</s-paragraph>
          ) : null}
        </s-section>
        <s-section heading="Undo">
          {latestWrite?.writeJobId ? (
            <s-paragraph>
              Latest rollbackable write: {latestWrite.writeJobId} ({latestWrite.outcome})
            </s-paragraph>
          ) : (
            <s-paragraph>No rollbackable write yet.</s-paragraph>
          )}
          <undoFetcher.Form action="/app/product-undos" method="post">
            <input name="writeJobId" type="hidden" value={latestWrite?.writeJobId ?? ""} />
            <button disabled={!canUndo} type="submit">
              {undoFetcher.state === "submitting" ? "Undoing..." : "Undo latest rollbackable write"}
            </button>
          </undoFetcher.Form>
          {undoFetcher.data?.error ? (
            <s-paragraph>Undo error: {undoFetcher.data.error}</s-paragraph>
          ) : null}
          <s-paragraph>State: {activeUndo?.jobState ?? undoFetcher.data?.state ?? "idle"}</s-paragraph>
          {activeUndo?.outcome ? (
            <s-paragraph>Outcome: {activeUndo.outcome}</s-paragraph>
          ) : null}
          {activeUndo?.lastError ? (
            <s-paragraph>Last error: {activeUndo.lastError}</s-paragraph>
          ) : null}
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
