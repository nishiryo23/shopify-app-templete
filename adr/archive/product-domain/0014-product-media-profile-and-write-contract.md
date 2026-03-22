# ADR-0014 Product media profile and write contract

- Status: Accepted
- Date: 2026-03-15
- Owners: Codex

## Context
`PD-007` では product media の import/update を Product Domain Parity MVP に追加する。既存 truth は `product-core-seo-v1`、`product-variants-v1`、`product-variants-prices-v1`、`product-inventory-v1` の export/preview/write contract に固定されている。
media は product に紐づく image リソースであり、product core fields の mutation とは別の `productCreateMedia` / `productDeleteMedia` mutation 系統を持つ。product core profile に列を足すと exact header contract を壊す。

## Decision
- media は既存 profile を拡張せず、新 profile `product-media-v1` として追加する。
- launch v1 の media scope は **product image（IMAGE type）** に固定する。VIDEO / EXTERNAL_VIDEO / MODEL_3D は later とする。
- `product-media-v1` の canonical CSV header は `product_id,product_handle,media_id,media_content_type,image_src,image_alt,image_position,updated_at` に固定する。
- row identity は `product_id + media_id` とする。新規 media 行は `media_id` を空にし `image_src` を必須とする。
- writable fields は `image_src`、`image_alt`、`image_position` とする。`product_handle`、`media_content_type`、`updated_at` は read-only とする。
- `image_src` は HTTPS URL のみ許可する。HTTP は preview error にする。空の場合は media 削除として扱う。
- `image_position` は **product の全 media 集合に対する 1-based integer** とする。blank の場合は Shopify のデフォルト順を維持する。position 変更は `productReorderMedia` mutation で適用する。
- export/read は product に紐づく全 IMAGE media を pagination で取得する。non-IMAGE（VIDEO, EXTERNAL_VIDEO, MODEL_3D）は export 対象外とし、CSV に出力しない。
- media pagination は Shopify GraphQL connection を追従し、product ごとに全 page を取得する。
- write は `productCreateMedia` で新規追加、`productUpdateMedia` で alt 更新、`productReorderMedia` で position 変更、image_src が空の既存 media は `productDeleteMedia` で削除する。
- 既存 media の `image_src` 変更は delete + create として処理する（Shopify は image source の in-place 更新を許可しないため）。
- `image_src` 差し替えの replace は、`image_position` 列が未変更でも旧 media の位置へ reorder して並び順を維持する。
- write は row 単位で逐次実行する。media mutation はバルク API を持たないため chunk 化しない。
- media profile でも `product.write.snapshot` artifact は作成する。ただし media write は launch v1 の undo 対象外とし、`product.write.result` の payload / metadata には `snapshotArtifactId` を載せない。
- write 前 revalidation は preview 時点の live media set を正本にする。`create` / `replace` / `image_position` 変更は product 単位で live media 集合（media id + alt + src + position）が一致していることを確認し、preview 後に他者が画像追加・削除・並び替えをしていた場合は `revalidation_failed` にする。
- success truth は final-state verification とし、write 後に live media を再読込して `image_alt` と `image_position` が一致した row のみ verified success とする。`image_src` は Shopify が CDN URL に変換するため URL 文字列の完全一致は求めない。
- `productCreateMedia` が `UPLOADED` / `PROCESSING` を返した row は、新しい media が live read に現れるまで polling してから final-state verification を行う。
- export は product ごとに少なくとも 1 行を出力する。IMAGE が 0 件の product は `media_id` / `image_src` を空にした placeholder 行を出し、通常の export → edit → preview 導線から最初の画像追加を作成できるようにする。edited CSV では同一 product に複数の新規 media 行を追加してよい。

## Consequences
- media を既存 profile contract を壊さずに追加できる。
- launch scope の media 定義が IMAGE-only として明文化される。
- final-state verification は alt + position ベースとし、src URL の CDN 変換を許容する。
- 画像が 0 件の product でも closed-loop export baseline を維持したまま create row を作れる。

## Alternatives considered
- `product-core-seo-v1` に media 列を追加する案
  exact header contract を壊すため不採用。
- staged upload を launch v1 で実装する案
  staged upload flow はバイナリ処理 + 一時 storage が必要で複雑度が高い。launch v1 では external URL import に限定し、staged upload は later とする。
- VIDEO / MODEL_3D を同 ticket に含める案
  mutation 体系と verification ロジックが異なるため、IMAGE に限定する。

## References
- `tickets/product-domain/PD-007-media-staged-uploads.md`
- `docs/shopify_app_technical_spec_complete.md` (Section 4.4)
- `adr/0005-product-domain-parity-mvp-boundary.md`
