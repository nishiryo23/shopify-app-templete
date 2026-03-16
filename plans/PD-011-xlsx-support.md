# PD-011 XLSX support plan

## Goal
launch scope の各 product-domain profile で、CSV と同一の preview/write truth を保ったまま XLSX import/export を扱えるようにする。format 差分は adapter 層に閉じ込め、preview artifact / write verification / undo semantics は既存 CSV 実装を正本として再利用する。

## Read first
- `tickets/product-domain/PD-011-xlsx-support.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `adr/0008-product-export-route-and-artifact-contract.md`
- `adr/0009-product-preview-route-and-provenance-contract.md`
- `adr/0010-product-write-verify-and-undo-contract.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `domain/products/export-profile.mjs`
- `app/services/product-exports.server.ts`
- `app/services/product-previews.server.ts`
- `app/routes/app.preview.tsx`
- `tests/contracts/product-export.contract.test.mjs`
- `tests/contracts/product-preview.contract.test.mjs`
- `tests/contracts/csv-provenance.contract.test.mjs`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract は変更しない。
- Shopify API / auth / billing / queue lane / single-writer truth は変更しない。`PD-011` は file format adapter の追加に閉じる。
- preview / write / undo の success truth は final-state verification のまま維持し、XLSX 導入を理由に mutation contract を広げない。
- canonical schema は既存 profile header を正本にし、XLSX 側で独自列や暗黙補正を追加しない。
- worksheet contract はこの ticket で固定する。XLSX は `1 workbook = 1 worksheet` とし、worksheet 名は selected profile と一致必須、header row は `A1` から始まる 1 行目固定、列順は既存 canonical header と完全一致必須にする。2 行目以降を data row とし、空の trailing row は無視、空 workbook・余剰 sheet・余剰 column・header reorder・header alias はすべて明示 error にする。
- 既存 install への影響は file upload/export UI のみとし、新しい env / scope / deploy prerequisite は増やさない。
- source provenance は fail-closed を維持する。XLSX の provenance/baseline binding 正本は raw binary ではなく canonical worksheet rows に固定し、uploaded workbook から抽出した canonical rows が export manifest と一致した場合のみ baseline として受理する。raw workbook binary は download artifact と storage integrity のために保持するが、preview truth には使わない。

## Steps
1. export/preview の format truth を整理し、`domain/products/export-profile.mjs` と related jobs/service で `csv` 固定前提を `csv | xlsx` に拡張する。dedupe key、payload、artifact metadata に format を持たせ、同一 profile で CSV と XLSX を別 job として識別できるようにする。preview result artifact は既存 payload shape を維持しつつ `format` を追加し、write/undo が参照する `rows/summary/*Digest` の意味は format をまたいで不変に保つ。
2. XLSX adapter 層を追加し、各 profile の canonical header を使って `export rows -> worksheet` と `worksheet -> normalized row objects` を双方向変換できるようにする。worksheet contract は `selected profile 名の単一 sheet + row1 exact header + row2 以降 data` に固定し、preview/build/write の core logic は既存 `*-preview-csv.mjs` / `*-export-csv.mjs` の row contract を維持し、XLSX はそこへ渡す前に canonical row objects へ正規化する。
3. provenance/baseline binding を壊さないように、source export artifact と preview edited upload artifact の format handling を更新する。XLSX の source provenance 正本は workbook から抽出した canonical worksheet rows とし、export 時にその canonical rows から manifest を生成する。preview route は uploaded source workbook を同じ canonicalization で再構成して manifest verify し、editedDigest も raw binary ではなく canonical worksheet rows から計算して harmless re-save や formatting-only change で preview semantics が分岐しないようにする。
4. `app/services/product-exports.server.ts` と `app/services/product-previews.server.ts`、`app/routes/app.preview.tsx` を更新し、format 選択、`.xlsx` upload accept、error copy、content type、artifact file name を format-aware にする。UI では selected export の format と upload 期待 format が一致しない場合を明示的に弾く。
5. contract tests を追加し、各 launch profile で CSV と XLSX の round-trip が同一 row/header contract に収束すること、preview/write semantics が format に依存しないこと、malformed worksheet や header mismatch が明示 error になることを固定する。必要なら XLSX fixture を dedicated test asset として追加する。
6. docs / ADR を更新し、launch v1 の worksheet contract、canonical truth、compatibility 限界、既存 installs への影響なしを明文化する。`PD-012` の Matrixify compatibility subset と責務が混ざらないよう、今回は「同一 header/order の XLSX 対応」までに閉じる。

## ADR impact
- ADR required: yes
- ADR: 0008, 0009, 0010, 0005
- Why: `PD-011` は export/preview route と artifact の file contract を CSV-only から CSV/XLSX 対応へ広げるため、route payload・artifact metadata・provenance/baseline binding の正本を更新する必要がある。preview result artifact に `format` を持たせ、`baselineDigest` / `editedDigest` の生成根拠を XLSX canonical rows に広げるため、write/undo が preview artifact を入力正本にする `ADR-0010` も確認対象に含める。launch boundary 自体は既に `ADR-0005` に CSV/XLSX が含まれているが、worksheet contract や compatibility の書き方が不足する場合は追記する。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- CSV/XLSX round-trip contract tests for each supported profile
- preview route tests for format mismatch, malformed worksheet, provenance/baseline verification
- export route tests for format-aware dedupe key / payload / artifact metadata
- write regression tests to confirm preview artifact generated from XLSX still drives the same changed-fields-only semantics

## Risks / open questions
- XLSX library 選定を誤ると bundle size / memory / ESM compatibility に影響する。streaming export と server-side parse の両立可否を先に確認する。
- Excel 特有の型変換で SKU、barcode、leading zero、日付が壊れるリスクがある。header だけでなく cell type coercion を fail-closed に設計しないと CSV と同一 semantics を守れない。
- `PD-012` で扱う Matrixify compatibility mapping と今回の worksheet contract を混ぜると責務が膨らむ。unsupported alias header はこの ticket では受けない前提を維持する。
