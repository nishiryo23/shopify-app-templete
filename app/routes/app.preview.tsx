import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, Select, Badge, Banner, Divider, Box, FormLayout, Link } from "@shopify/polaris";
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

    const params = new URLSearchParams(searchParams);
    params.set("profile", selectedProfile);
    params.delete("jobId");
    if (activePreviewJobId) {
      params.set("previewJobId", activePreviewJobId);
    } else {
      params.delete("previewJobId");
    }
    if (activeWriteJobId) {
      params.set("writeJobId", activeWriteJobId);
    } else {
      params.delete("writeJobId");
    }
    if (activeUndoJobId) {
      params.set("undoJobId", activeUndoJobId);
    } else {
      params.delete("undoJobId");
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
    searchParams,
    selectedProfile,
  ]);

  return (
    <div data-testid="preview-shell">
      <Page title="プレビュー">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">対象プロファイル</Text>
                <div style={{ maxWidth: "24rem" }}>
                  <FormLayout>
                    <Select
                      label="プロファイル"
                      options={PRODUCT_PROFILE_OPTIONS.map((option) => ({ label: getProductProfileLabel(option.value), value: option.value }))}
                      onChange={(value: string) => {
                        const nextParams = new URLSearchParams(searchParams);
                        nextParams.set("profile", value);
                        nextParams.delete("previewJobId");
                        nextParams.delete("jobId");
                        nextParams.delete("writeJobId");
                        nextParams.delete("undoJobId");
                        setSearchParams(nextParams);
                      }}
                      value={selectedProfile}
                    />
                    <exportFetcher.Form action="/app/product-exports" method="post">
                      <FormLayout>
                        <Select
                          label="形式"
                          options={[{label: "csv", value: "csv"}, {label: "xlsx", value: "xlsx"}]}
                          onChange={setSelectedExportFormat}
                          value={selectedExportFormat}
                        />
                        <input name="format" type="hidden" value={selectedExportFormat} />
                        <input name="profile" type="hidden" value={selectedProfile} />
                        <Button submit variant="primary" loading={exportFetcher.state === "submitting"}>
                          エクスポートを作成
                        </Button>
                      </FormLayout>
                    </exportFetcher.Form>
                    {exportFetcher.data?.jobId ? (
                      <Text as="p">
                        エクスポートジョブ: {exportFetcher.data.jobId} ({getFormatLabel(exportFetcher.data.format ?? selectedExportFormat)})
                      </Text>
                    ) : null}
                  </FormLayout>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">原本ファイルと編集ファイルのアップロード</Text>
                <Text as="p">
                  原本ファイルは、選択したエクスポートと同じ形式のみアップロードできます。原本との一致確認を行うため、Matrixify 互換モードでも原本ファイルが必要です。
                </Text>
                <createFetcher.Form action="/app/product-previews" encType="multipart/form-data" method="post">
                  <div style={{ maxWidth: "42rem" }}>
                    <FormLayout>
                      <Select
                        label="完了済みエクスポート"
                        name="exportJobId"
                        options={loadedExports.map((job) => ({ label: `${job.id} (${job.createdAt}, ${job.format})`, value: job.id }))}
                        onChange={setSelectedExportJobId}
                        value={selectedExportJobId}
                      />
                      {selectedExportJobId && (
                        <InlineStack gap="200" align="start">
                          <Link url={`/app/product-exports?jobId=${selectedExportJobId}`} target="_blank">
                            原本ファイルをダウンロード
                          </Link>
                        </InlineStack>
                      )}
                      <input name="profile" type="hidden" value={selectedProfile} />
                      <Select
                        label="編集レイアウト"
                        name="editedLayout"
                        options={[
                          { label: getEditedLayoutLabel("canonical"), value: "canonical" },
                          { label: getEditedLayoutLabel("matrixify"), value: "matrixify" }
                        ]}
                        onChange={setEditedLayout}
                        value={editedLayout}
                      />
                      <div>
                        <Text as="p" fontWeight="medium">原本 {getFormatLabel(selectedBaselineFormat)}</Text>
                        <Box paddingBlockStart="100">
                          <input name="sourceFile" required type="file" accept={sourceUploadAccept} />
                        </Box>
                      </div>
                      <div>
                        <Text as="p" fontWeight="medium">編集版 {editedLayout === "matrixify" ? "CSV/XLSX (Matrixify 互換サブセット)" : getFormatLabel(selectedBaselineFormat)}</Text>
                        <Box paddingBlockStart="100">
                          <input name="editedFile" required type="file" accept={editedUploadAccept} />
                        </Box>
                      </div>
                      <Text as="p" tone="subdued">
                        {editedLayout === "matrixify"
                          ? "Matrixify 互換モードでは、編集ファイルに Matrixify 互換の CSV または XLSX を使えます。原本にはアプリから出力したファイルを指定してください。"
                          : "標準レイアウトでは、原本と編集版の両方が選択したエクスポートと同じ形式である必要があります。"}
                      </Text>
                      <Button submit variant="primary" loading={createFetcher.state === "submitting"}>
                        プレビューを作成
                      </Button>
                    </FormLayout>
                  </div>
                </createFetcher.Form>
                {createFetcher.data?.jobId ? (
                  <Text as="p">プレビュージョブ: {createFetcher.data.jobId}</Text>
                ) : null}
                {createFetcher.data?.error ? (
                  <Banner tone="critical"><p>リクエストエラー: {createFetcher.data.error}</p></Banner>
                ) : null}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">プレビューの状態</Text>
                <BlockStack gap="300">
                  <InlineStack gap="200" align="start">
                    <Text as="p" fontWeight="medium">状態:</Text>
                    <Badge tone={activePreview?.jobState === 'completed' ? 'success' : 'info'}>
                      {getJobStateLabel(activePreview?.jobState ?? createFetcher.data?.state ?? "idle")}
                    </Badge>
                  </InlineStack>
                  {activePreview?.lastError ? (
                    <Banner tone="critical"><p>直近のエラー: {activePreview.lastError}</p></Banner>
                  ) : null}
                  {activePreview?.summary ? (
                    <div data-testid="preview-summary">
                      <BlockStack gap="200">
                        <Text as="p">合計: {activePreview.summary.total}</Text>
                        <Text as="p">変更あり: {activePreview.summary.changed}</Text>
                        <Text as="p">変更なし: {activePreview.summary.unchanged}</Text>
                        <Text as="p">要確認: {activePreview.summary.warning}</Text>
                        <Text as="p">エラー: {activePreview.summary.error}</Text>
                      </BlockStack>
                    </div>
                  ) : (
                    <Text as="p" tone="subdued">原本ファイルと編集ファイルを送信するとプレビューを生成できます。</Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">書き込み</Text>
                <BlockStack gap="300">
                  <InlineStack gap="400">
                    <Text as="p">契約状態: {getEntitlementStateLabel(data.entitlementState)}</Text>
                    <Text as="p">ショップオーナー権限: {data.isAccountOwner ? "あり" : "なし"}</Text>
                  </InlineStack>
                  <writeFetcher.Form action="/app/product-writes" method="post">
                    <input name="previewJobId" type="hidden" value={activePreviewJobId ?? ""} />
                    <Button submit disabled={!canConfirm} variant="primary" loading={writeFetcher.state === "submitting"}>
                      確定して書き込む
                    </Button>
                  </writeFetcher.Form>
                  {!previewHasWritableRows && activePreview?.jobState === "completed" ? (
                    <Text as="p" tone="subdued">このプレビューには書き込み対象の行がありません。</Text>
                  ) : null}
                  {!data.isAccountOwner ? (
                    <Text as="p" tone="subdued">書き込み確定はショップオーナーのみ実行できます。</Text>
                  ) : null}
                  {data.entitlementState !== "ACTIVE_PAID" ? (
                    <Text as="p" tone="subdued">書き込みと取り消しには有効な契約が必要です。</Text>
                  ) : null}
                  {previewAlreadyHasVerifiedWrite ? (
                    <Banner tone="warning">
                      <p>
                        このプレビューには、すでに検証済みの成功書き込みがあります
                        {selectedPreviewVerifiedWrite?.writeJobId ? ` (${selectedPreviewVerifiedWrite.writeJobId})` : ""}.
                      </p>
                    </Banner>
                  ) : null}
                  {writeFetcher.data?.error ? (
                    <Banner tone="critical"><p>書き込みエラー: {writeFetcher.data.error}</p></Banner>
                  ) : null}
                  <InlineStack gap="200" align="start">
                    <Text as="p">状態:</Text>
                    <Badge tone={activeWrite?.jobState === 'completed' ? 'success' : 'info'}>
                      {getJobStateLabel(activeWrite?.jobState ?? writeFetcher.data?.state ?? "idle")}
                    </Badge>
                  </InlineStack>
                  {activeWrite?.outcome ? (
                    <Text as="p">結果: {getOutcomeLabel(activeWrite.outcome)}</Text>
                  ) : null}
                  {activeWrite?.lastError ? (
                    <Banner tone="critical"><p>直近のエラー: {activeWrite.lastError}</p></Banner>
                  ) : null}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">取り消し</Text>
                <BlockStack gap="300">
                  {selectedProfile !== "product-core-seo-v1" ? (
                    <Text as="p" tone="subdued">取り消しは商品基本情報・SEOプロファイルでのみ利用できます。</Text>
                  ) : latestWrite?.retentionExpired ? (
                    <Text as="p" tone="subdued">最新のロールバック可能な書き戻しは保持期限切れです。</Text>
                  ) : latestWrite?.writeJobId ? (
                    <Text as="p">
                      最新のロールバック可能な書き戻し: {latestWrite.writeJobId}
                      {latestWrite.outcome ? ` (${getOutcomeLabel(latestWrite.outcome)})` : ""}
                    </Text>
                  ) : (
                    <Text as="p" tone="subdued">まだロールバック可能な書き戻しはありません。</Text>
                  )}
                  {selectedProfile === "product-core-seo-v1" ? (
                    <BlockStack gap="300">
                      <undoFetcher.Form action="/app/product-undos" method="post">
                        <input name="writeJobId" type="hidden" value={latestWrite?.writeJobId ?? ""} />
                        <Button submit disabled={!canUndo} variant="primary" tone="critical" loading={undoFetcher.state === "submitting"}>
                          最新のロールバック可能な書き戻しを取り消す
                        </Button>
                      </undoFetcher.Form>
                      {undoFetcher.data?.error ? (
                        <Banner tone="critical"><p>取り消しエラー: {undoErrorMessage}</p></Banner>
                      ) : null}
                      <InlineStack gap="200" align="start">
                        <Text as="p">状態:</Text>
                        <Badge tone={activeUndo?.jobState === 'completed' ? 'success' : 'info'}>
                          {getJobStateLabel(activeUndo?.jobState ?? undoFetcher.data?.state ?? "idle")}
                        </Badge>
                      </InlineStack>
                      {activeUndo?.outcome ? (
                        <Text as="p">結果: {getOutcomeLabel(activeUndo.outcome)}</Text>
                      ) : null}
                      {activeUndo?.lastError ? (
                        <Banner tone="critical"><p>直近のエラー: {activeUndo.lastError}</p></Banner>
                      ) : null}
                    </BlockStack>
                  ) : null}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">行ごとの結果</Text>
                {activePreview?.rows?.length ? (
                  <BlockStack gap="400">
                    {activePreview.rows.slice(0, 20).map((row, index) => (
                      <Box key={`${row.editedRowNumber}:${row.productId}`}>
                        {index > 0 && <Box paddingBlockEnd="400"><Divider /></Box>}
                        <BlockStack gap="200">
                          <Text as="p" fontWeight="bold">
                            編集 #{row.editedRowNumber} / 原本 #{row.sourceRowNumber ?? "-"} / {row.productId} / <Badge>{getClassificationLabel(row.classification)}</Badge>
                          </Text>
                          {row.changedFields.length > 0 ? (
                            <Text as="p" tone="subdued">
                              変更項目: {row.changedFields.map((field) => getFieldLabel(field)).join(", ")}
                            </Text>
                          ) : null}
                          {row.messages.map((message) => (
                            <Text as="p" tone="critical" key={message}>{message}</Text>
                          ))}
                        </BlockStack>
                      </Box>
                    ))}
                  </BlockStack>
                ) : (
                  <Text as="p" tone="subdued">まだプレビュー行はありません。</Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
