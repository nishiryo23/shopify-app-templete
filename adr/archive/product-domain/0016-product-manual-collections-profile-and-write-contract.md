# ADR-0016 Product manual collections profile and write contract

- Status: Accepted
- Date: 2026-03-15
- Owners: Codex

## Context
`PD-009` では manual collection membership を Product Domain Parity MVP の export / preview / write pipeline に追加する。既存 truth は profile ごとに exact CSV header、row identity、write mutation、verification strategy を ADR と contract tests に固定している。

collections は product core や variants と異なり、membership add/remove が async job を返し、success truth を mutation 完了ではなく post-verification read に置く必要がある。また smart collections は manual membership write 対象外であり、manual collection handle 解決と nested pagination も source-of-truth として固定する必要がある。

## Decision
- manual collection membership は既存 profile を拡張せず、新 profile `product-manual-collections-v1` として追加する。
- canonical CSV header は `product_id,product_handle,collection_id,collection_handle,collection_title,membership,updated_at` に固定する。
- `membership` は `member` または `remove` の 2 値のみとし、row omission に delete semantics は持たせない。
- row identity は `product_id + resolved_collection_id` とする。
- `resolved_collection_id` は `collection_id` を優先し、空欄時のみ `collection_handle` を `collectionByIdentifier` で解決する。
- `collection_id` と `collection_handle` が両方あり不一致な row は preview error にする。
- merchant は既知の manual collection handle を入力して add row を作成できる。collection picker や collection catalog export は launch v1 では提供しない。
- smart collections、unknown collections、manual 判定不能 row は preview error にし、write 対象にしない。
- export/read は nested collections connection を cursor pagination で最後まで取得し、manual collections のみ row 化する。
- add は `collectionAddProductsV2`、remove は `collectionRemoveProducts` を使い、collection 単位で `productIds` を最大 250 件に chunk する。
- async completion は `Job.done` を poll して判定し、5 分超過時は `shopify-async-job-timeout` として terminal technical failure にする。
- success truth は post-verification read とし、verify read で intended membership と一致した row のみ verified success とする。
- write queue の `maxAttempts: 1` は維持し、この profile でも自動 retry は導入しない。
- undo は提供しない。

## Consequences
- manual collection membership を既存 profile contract を壊さずに追加できる。
- smart collections と collection create/update を scope 外に閉じ込められる。
- async job completion と verification truth が明文化される。

## Alternatives considered
- `product-core-seo-v1` に collection 列を追加する案
  exact header contract を壊すため不採用。
- `collectionAddProducts` を使う案
  remove 側との async model の対称性を崩すため不採用。
- row omission を remove semantics にする案
  preview/write/verify の一貫性を壊すため不採用。

## References
- `tickets/product-domain/PD-009-manual-collections-membership.md`
- `docs/shopify_app_technical_spec_complete.md` (Section 4.6)
- `adr/0005-product-domain-parity-mvp-boundary.md`
