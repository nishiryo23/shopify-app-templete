# ADR-0009 Product preview route and provenance contract

- Status: Accepted
- Date: 2026-03-13
- Owners: Codex

## Context
`PD-002` では `PD-001` の export artifact を baseline にした closed-loop preview を追加するが、preview route contract、source provenance verify の対象、preview dedupe、offline session 不在時の挙動、summary/read model の正本が未固定だった。

`ADR-0007` は queue / artifact / provenance signing の共通 truth を定め、`ADR-0008` は export source と manifest artifact を private storage の正本にした。preview がこれと別の baseline truth を持つと、`PD-003` の confirm / write / revalidation へ繋がらない。

## Decision
- preview request は `POST /app/product-previews` で受ける。
- route は `authenticateAndBootstrapShop(request)` で shop を確定し、preview は未課金でも許可する。billing gate は `PD-003` の confirm/write で適用する。
- preview baseline に使える export は、同一 shop の completed `product.export` job であり、対応する `product.export.source` と `product.export.manifest` artifact が両方存在し、`deletedAt IS NULL` の場合のみとする。
- source provenance verify は `exportJobId + source file + manifest artifact` を正本にし、CSV/XLSX のどちらでも canonical rows に変換したうえで `manifest verify` / `row fingerprint verify` を行う。
- edited CSV は provenance 対象ではなく baseline binding 対象とする。このルールを XLSX にも同じ canonical rows semantics で拡張する。closed-loop の意味は、app が生成した canonical rows を baseline とし、その baseline 上の rows だけを merchant が編集することに固定する。
- preview request は `sourceFile` と `editedFile` の両方を必須とする。Matrixify compatibility を使う場合も source upload requirement は緩めず、edited file にだけ `editedLayout=matrixify` を許可する。
- preview route payload / result / artifact metadata は `sourceFormat`, `editedFormat`, `editedLayout`, `editedRowMapDigest` を持つ。source と edited は別 format で canonicalize できるが、preview/write truth は常に canonical CSV rows に収束させる。
- preview dedupe key は `product-preview:${exportJobId}:${editedLayout}:${editedDigest}:${editedRowMapDigest}` とし、active states は `queued / retryable / leased` に固定する。terminal job は accepted response に再利用しない。
- preview worker は offline Admin client で live Shopify state を読む。offline session 不在は retryable にせず terminal failure とし、stable error code は `missing-offline-session`、`product.preview` job の `maxAttempts` は `1` とする。
- preview route が新たに保存する upload artifact は edited file のみで、kind は `product.preview.edited-upload` とする。source file は既存 `product.export.source` artifact を正本にし、preview 側で再保存しない。
- worksheet contract は `1 workbook = 1 worksheet`、worksheet 名は selected profile と一致、header row は `A1` 開始で canonical header と完全一致、2 行目以降を data row、trailing empty rows のみ無視に固定する。extra sheet / extra column / header alias / non-text cell は reject する。
- Matrixify compatibility は import-only subset に限定する。allowed headers は profile ごとの subset match で検証し、unknown header, missing required header, unsupported destructive semantics, unsupported type/command は explicit error に落とす。
- preview result artifact は `product.preview.result` とし、`sourceFormat`, `editedFormat`, `editedLayout`, `editedRowMapDigest`, `summary`, `rows`, `baselineDigest`, `editedDigest`, `previewDigest`, `sourceArtifactId`, `manifestArtifactId`, `editedUploadArtifactId`, `exportJobId`, `profile` を payload に持つ。
- `previewDigest` は `profile`, `exportJobId`, `baselineDigest`, `editedDigest`, `editedLayout`, `editedRowMapDigest`, `summary`, `rows[].productId`, `rows[].classification`, `rows[].changedFields`, `rows[].baselineRow`, `rows[].editedRow`, `rows[].currentRow` を stable key order で canonical JSON 化した値の sha256 とする。UI 表示順そのものではなく row-map digest を hash 対象に含める。
- preview は既存 PostgreSQL-backed queue と `JobLease` の shop 単位 lease をそのまま使い、基盤上は同一 shop の export/write 系 job と直列実行される。この ticket では queue truth を変更しない。

## Consequences
- preview は export artifact を baseline にした closed loop を持ちつつ、`PD-003` の confirm 時に preview hash revalidation を行える。
- source provenance と edited binding の責務を分けることで、`PD-001` の export contract を壊さずに `PD-002` を実装できる。XLSX は workbook binary ではなく canonical rows を正本にするので、harmless re-save や表示書式差分で preview semantics がぶれにくい。
- preview は write 系と同じ queue lane に乗るため、同一 shop では safety を優先して直列実行になる。
- offline session 不在で無意味な preview retry を避けられる。

## Alternatives considered
- source CSV を digest だけで逆引きする案
  同一内容 export が複数ありうるため、baseline 解決が曖昧になるので不採用。
- edited CSV に provenance 列を追加する案
  `PD-001` の export contract を壊し、review ループと migration を広げるため不採用。
- preview を write/export と別 queue lane に分ける案
  queue truth を変更する別 ticket 相当の設計判断になるため不採用。

## References
- `tickets/product-domain/PD-002-upload-provenance-preview-engine.md`
- `adr/0007-db-queue-artifact-and-provenance-crypto-truth.md`
- `adr/0008-product-export-route-and-artifact-contract.md`
- `docs/shopify_app_technical_spec_complete.md`
