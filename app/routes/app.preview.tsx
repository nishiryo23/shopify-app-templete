import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { loadProductPreviewPage } from "~/app/services/product-previews.server";
import {
  getClassificationLabel,
  getEditedLayoutLabel,
  getEntitlementStateLabel,
  getFieldLabel,
  getFormatLabel,
  getJobStateLabel,
  getOutcomeLabel,
  getProductProfileLabel,
  PRODUCT_PROFILE_OPTIONS,
} from "~/app/utils/admin-copy";

export const loader = (args: LoaderFunctionArgs) => loadProductPreviewPage(args);

type PreviewLoaderData = {
  entitlementState: string;
  exports: Array<{
    createdAt: string;
    format: string;
    id: string;
    profile: string;
  }>;
  isAccountOwner: boolean;
  latestWrite: null | {
    outcome: string | null;
    previewJobId: string | null;
    retentionExpired?: boolean;
    total: number | null;
    writeJobId: string | null;
  };
  selectedPreviewVerifiedWrite: null | {
    writeJobId: string | null;
  };
  preview: null | {
    editedFormat?: string;
    editedLayout?: string;
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
    sourceFormat?: string;
    summary: Record<string, number> | null;
  };
  selectedProfile: string;
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
  const exportFetcher = useFetcher<{
    error?: string;
    format?: string;
    jobId: string;
    profile: string;
    state: string;
  }>();
  const createFetcher = useFetcher<{
    editedFormat?: string;
    editedLayout?: string;
    error?: string;
    exportJobId: string;
    format?: string;
    jobId: string;
    profile: string;
    sourceFormat?: string;
    state: string;
  }>();
  const writeFetcher = useFetcher<{
    error?: string;
    jobId: string;
    previewJobId: string;
    state: string;
  }>();
  const undoFetcher = useFetcher<{
    code?: string;
    error?: string;
    jobId: string;
    state: string;
    writeJobId: string;
  }>();
  const detailFetcher = useFetcher<PreviewLoaderData>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProfile = searchParams.get("profile") ?? data.selectedProfile;
  const selectedLoaderData = detailFetcher.data?.selectedProfile === selectedProfile
    ? detailFetcher.data
    : data.selectedProfile === selectedProfile
      ? data
      : null;
  const loadedExports = selectedLoaderData?.exports ?? [];
  const [selectedExportJobId, setSelectedExportJobId] = useState(loadedExports[0]?.id ?? "");
  const [selectedExportFormat, setSelectedExportFormat] = useState("csv");
  const [editedLayout, setEditedLayout] = useState("canonical");
  const latestWrite = selectedLoaderData?.latestWrite ?? null;
  const activePreview = selectedLoaderData?.preview ?? null;
  const activeWrite = selectedLoaderData?.write ?? null;
  const activeUndo = selectedLoaderData?.undo ?? null;
  const activeExportJobId = exportFetcher.data?.profile === selectedProfile
    ? exportFetcher.data.jobId
    : null;
  const activePreviewJobId = createFetcher.data?.jobId ?? searchParams.get("previewJobId") ?? searchParams.get("jobId");
  const activeWriteJobId = writeFetcher.data?.jobId ?? searchParams.get("writeJobId");
  const activeUndoJobId = undoFetcher.data?.jobId ?? searchParams.get("undoJobId");
  const previewHasWritableRows = Boolean(activePreview?.rows?.some((row) => row.changedFields.length > 0));
  const selectedExport = loadedExports.find((job) => job.id === selectedExportJobId) ?? null;
  const selectedBaselineFormat = selectedExport?.format ?? createFetcher.data?.format ?? "csv";
  const sourceUploadAccept = selectedBaselineFormat === "xlsx"
    ? ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : ".csv,text/csv";
  const editedUploadAccept = editedLayout === "matrixify"
    ? ".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : sourceUploadAccept;
  const selectedPreviewVerifiedWrite = selectedLoaderData?.selectedPreviewVerifiedWrite ?? null;
  const previewAlreadyHasVerifiedWrite = Boolean(selectedPreviewVerifiedWrite?.writeJobId);
  const undoErrorMessage = undoFetcher.data?.code === "retention_expired"
    ? "最新のロールバック可能な書き戻しは保持期限切れです。"
    : undoFetcher.data?.error;
  const canConfirm = data.isAccountOwner
    && data.entitlementState === "ACTIVE_PAID"
    && activePreview?.jobState === "completed"
    && previewHasWritableRows
    && !previewAlreadyHasVerifiedWrite;
  const canUndo = data.isAccountOwner
    && data.entitlementState === "ACTIVE_PAID"
    && selectedProfile === "product-core-seo-v1"
    && !latestWrite?.retentionExpired
    && Boolean(latestWrite?.writeJobId);

  useEffect(() => {
    if (loadedExports.some((job) => job.id === selectedExportJobId)) {
      return;
    }

    setSelectedExportJobId(loadedExports[0]?.id ?? "");
  }, [loadedExports, selectedExportJobId]);

  useEffect(() => {
    if (!createFetcher.data?.jobId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("previewJobId", createFetcher.data.jobId);
    nextParams.delete("jobId");
    nextParams.set("profile", selectedProfile);
    setSearchParams(nextParams, { replace: true });
  }, [createFetcher.data?.jobId, searchParams, selectedProfile, setSearchParams]);

  useEffect(() => {
    if (!writeFetcher.data?.jobId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("writeJobId", writeFetcher.data.jobId);
    nextParams.set("profile", selectedProfile);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, selectedProfile, setSearchParams, writeFetcher.data?.jobId]);

  useEffect(() => {
    if (!undoFetcher.data?.jobId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("undoJobId", undoFetcher.data.jobId);
    nextParams.set("profile", selectedProfile);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, selectedProfile, setSearchParams, undoFetcher.data?.jobId]);

  useEffect(() => {
    if (!activeExportJobId && !activePreviewJobId && !activeWriteJobId && !activeUndoJobId) {
      return;
    }

    const params = new URLSearchParams();
    params.set("profile", selectedProfile);
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

    const exportVisible = !activeExportJobId || loadedExports.some((job) => job.id === activeExportJobId);
    const isPreviewTerminal = !activePreview || activePreview.jobState === "completed" || activePreview.jobState === "dead_letter";
    const isWriteTerminal = !activeWrite || activeWrite.jobState === "completed" || activeWrite.jobState === "dead_letter";
    const isUndoTerminal = !activeUndo || activeUndo.jobState === "completed" || activeUndo.jobState === "dead_letter";

    if (exportVisible && isPreviewTerminal && isWriteTerminal && isUndoTerminal) {
      return;
    }

    const timer = setInterval(load, 1000);

    return () => clearInterval(timer);
  }, [
    activeExportJobId,
    activePreview?.jobState,
    activePreviewJobId,
    activeUndo?.jobState,
    activeUndoJobId,
    activeWrite?.jobState,
    activeWriteJobId,
    loadedExports,
    selectedProfile,
  ]);

  return (
    <div data-testid="preview-shell">
      <s-page heading="プレビュー">
        <s-section heading="対象プロファイル">
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}>
            <label>
              <span>プロファイル</span>
              <select
                onChange={(event) => {
                  const nextParams = new URLSearchParams(searchParams);
                  nextParams.set("profile", event.currentTarget.value);
                  nextParams.delete("previewJobId");
                  nextParams.delete("jobId");
                  nextParams.delete("writeJobId");
                  nextParams.delete("undoJobId");
                  setSearchParams(nextParams);
                }}
                value={selectedProfile}
              >
                {PRODUCT_PROFILE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {getProductProfileLabel(option.value)}
                  </option>
                ))}
              </select>
            </label>
            <exportFetcher.Form action="/app/product-exports" method="post">
              <label>
                <span>形式</span>
                <select onChange={(event) => setSelectedExportFormat(event.currentTarget.value)} value={selectedExportFormat}>
                  <option value="csv">csv</option>
                  <option value="xlsx">xlsx</option>
                </select>
              </label>
              <input name="format" type="hidden" value={selectedExportFormat} />
              <input name="profile" type="hidden" value={selectedProfile} />
              <button type="submit">
                {exportFetcher.state === "submitting" ? "エクスポートを作成しています..." : "エクスポートを作成"}
              </button>
            </exportFetcher.Form>
            {exportFetcher.data?.jobId ? (
              <s-paragraph>
                エクスポートジョブ: {exportFetcher.data.jobId} ({getFormatLabel(exportFetcher.data.format ?? selectedExportFormat)})
              </s-paragraph>
            ) : null}
          </div>
        </s-section>
        <s-section heading="原本ファイルと編集ファイルのアップロード">
          <s-paragraph>
            原本ファイルは、選択したエクスポートと同じ形式のみアップロードできます。原本との一致確認を行うため、Matrixify 互換モードでも原本ファイルが必要です。
          </s-paragraph>
          <createFetcher.Form action="/app/product-previews" encType="multipart/form-data" method="post">
            <div style={{ display: "grid", gap: "0.75rem", maxWidth: "42rem" }}>
              <label>
                <span>完了済みエクスポート</span>
                <select
                  name="exportJobId"
                  onChange={(event) => setSelectedExportJobId(event.currentTarget.value)}
                  value={selectedExportJobId}
                >
                  {loadedExports.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.id} ({job.createdAt}, {job.format})
                    </option>
                  ))}
                </select>
              </label>
              <input name="profile" type="hidden" value={selectedProfile} />
              <label>
                <span>編集レイアウト</span>
                <select
                  name="editedLayout"
                  onChange={(event) => setEditedLayout(event.currentTarget.value)}
                  value={editedLayout}
                >
                  <option value="canonical">{getEditedLayoutLabel("canonical")}</option>
                  <option value="matrixify">{getEditedLayoutLabel("matrixify")}</option>
                </select>
              </label>
              <label>
                <span>原本 {getFormatLabel(selectedBaselineFormat)}</span>
                <input name="sourceFile" required type="file" accept={sourceUploadAccept} />
              </label>
              <label>
                <span>
                  編集版 {editedLayout === "matrixify" ? "CSV/XLSX (Matrixify 互換サブセット)" : getFormatLabel(selectedBaselineFormat)}
                </span>
                <input name="editedFile" required type="file" accept={editedUploadAccept} />
              </label>
              <s-paragraph>
                {editedLayout === "matrixify"
                  ? "Matrixify 互換モードでは、編集ファイルに Matrixify 互換の CSV または XLSX を使えます。原本にはアプリから出力したファイルを指定してください。"
                  : "標準レイアウトでは、原本と編集版の両方が選択したエクスポートと同じ形式である必要があります。"}
              </s-paragraph>
              <button type="submit">
                {createFetcher.state === "submitting" ? "アップロードしています..." : "プレビューを作成"}
              </button>
            </div>
          </createFetcher.Form>
          {createFetcher.data?.jobId ? (
            <s-paragraph>プレビュージョブ: {createFetcher.data.jobId}</s-paragraph>
          ) : null}
          {createFetcher.data?.error ? (
            <s-paragraph>リクエストエラー: {createFetcher.data.error}</s-paragraph>
          ) : null}
        </s-section>
        <s-section heading="プレビューの状態">
          <s-paragraph>
            状態: {getJobStateLabel(activePreview?.jobState ?? createFetcher.data?.state ?? "idle")}
          </s-paragraph>
          {activePreview?.lastError ? (
            <s-paragraph>直近のエラー: {activePreview.lastError}</s-paragraph>
          ) : null}
          {activePreview?.summary ? (
            <div data-testid="preview-summary">
              <s-paragraph>合計: {activePreview.summary.total}</s-paragraph>
              <s-paragraph>変更あり: {activePreview.summary.changed}</s-paragraph>
              <s-paragraph>変更なし: {activePreview.summary.unchanged}</s-paragraph>
              <s-paragraph>要確認: {activePreview.summary.warning}</s-paragraph>
              <s-paragraph>エラー: {activePreview.summary.error}</s-paragraph>
            </div>
          ) : (
            <s-paragraph>原本ファイルと編集ファイルを送信するとプレビューを生成できます。</s-paragraph>
          )}
        </s-section>
        <s-section heading="書き込み">
          <s-paragraph>契約状態: {getEntitlementStateLabel(data.entitlementState)}</s-paragraph>
          <s-paragraph>ショップオーナー権限: {data.isAccountOwner ? "あり" : "なし"}</s-paragraph>
          <writeFetcher.Form action="/app/product-writes" method="post">
            <input name="previewJobId" type="hidden" value={activePreviewJobId ?? ""} />
            <button disabled={!canConfirm} type="submit">
              {writeFetcher.state === "submitting" ? "確定して書き込んでいます..." : "確定して書き込む"}
            </button>
          </writeFetcher.Form>
          {!previewHasWritableRows && activePreview?.jobState === "completed" ? (
            <s-paragraph>このプレビューには書き込み対象の行がありません。</s-paragraph>
          ) : null}
          {!data.isAccountOwner ? (
            <s-paragraph>書き込み確定はショップオーナーのみ実行できます。</s-paragraph>
          ) : null}
          {data.entitlementState !== "ACTIVE_PAID" ? (
            <s-paragraph>書き込みと取り消しには有効な契約が必要です。</s-paragraph>
          ) : null}
          {previewAlreadyHasVerifiedWrite ? (
            <s-paragraph>
              このプレビューには、すでに検証済みの成功書き込みがあります
              {selectedPreviewVerifiedWrite?.writeJobId ? ` (${selectedPreviewVerifiedWrite.writeJobId})` : ""}.
            </s-paragraph>
          ) : null}
          {writeFetcher.data?.error ? (
            <s-paragraph>書き込みエラー: {writeFetcher.data.error}</s-paragraph>
          ) : null}
          <s-paragraph>状態: {getJobStateLabel(activeWrite?.jobState ?? writeFetcher.data?.state ?? "idle")}</s-paragraph>
          {activeWrite?.outcome ? (
            <s-paragraph>結果: {getOutcomeLabel(activeWrite.outcome)}</s-paragraph>
          ) : null}
          {activeWrite?.lastError ? (
            <s-paragraph>直近のエラー: {activeWrite.lastError}</s-paragraph>
          ) : null}
        </s-section>
        <s-section heading="取り消し">
          {selectedProfile !== "product-core-seo-v1" ? (
            <s-paragraph>取り消しは商品基本情報・SEOプロファイルでのみ利用できます。</s-paragraph>
          ) : latestWrite?.retentionExpired ? (
            <s-paragraph>最新のロールバック可能な書き戻しは保持期限切れです。</s-paragraph>
          ) : latestWrite?.writeJobId ? (
            <s-paragraph>
              最新のロールバック可能な書き戻し: {latestWrite.writeJobId}
              {latestWrite.outcome ? ` (${getOutcomeLabel(latestWrite.outcome)})` : ""}
            </s-paragraph>
          ) : (
            <s-paragraph>まだロールバック可能な書き戻しはありません。</s-paragraph>
          )}
          {selectedProfile === "product-core-seo-v1" ? (
            <>
              <undoFetcher.Form action="/app/product-undos" method="post">
                <input name="writeJobId" type="hidden" value={latestWrite?.writeJobId ?? ""} />
                <button disabled={!canUndo} type="submit">
                  {undoFetcher.state === "submitting" ? "取り消しています..." : "最新のロールバック可能な書き戻しを取り消す"}
                </button>
              </undoFetcher.Form>
              {undoFetcher.data?.error ? (
                <s-paragraph>取り消しエラー: {undoErrorMessage}</s-paragraph>
              ) : null}
              <s-paragraph>状態: {getJobStateLabel(activeUndo?.jobState ?? undoFetcher.data?.state ?? "idle")}</s-paragraph>
              {activeUndo?.outcome ? (
                <s-paragraph>結果: {getOutcomeLabel(activeUndo.outcome)}</s-paragraph>
              ) : null}
              {activeUndo?.lastError ? (
                <s-paragraph>直近のエラー: {activeUndo.lastError}</s-paragraph>
              ) : null}
            </>
          ) : null}
        </s-section>
        <s-section heading="行ごとの結果">
          {activePreview?.rows?.length ? (
            <div>
              {activePreview.rows.slice(0, 20).map((row) => (
                <div key={`${row.editedRowNumber}:${row.productId}`} style={{ marginBottom: "0.75rem" }}>
                  <s-paragraph>
                    編集 #{row.editedRowNumber} / 原本 #{row.sourceRowNumber ?? "-"} / {row.productId} / {getClassificationLabel(row.classification)}
                  </s-paragraph>
                  {row.changedFields.length > 0 ? (
                    <s-paragraph>
                      変更項目: {row.changedFields.map((field) => getFieldLabel(field)).join(", ")}
                    </s-paragraph>
                  ) : null}
                  {row.messages.map((message) => (
                    <s-paragraph key={message}>{message}</s-paragraph>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <s-paragraph>まだプレビュー行はありません。</s-paragraph>
          )}
        </s-section>
      </s-page>
    </div>
  );
}
