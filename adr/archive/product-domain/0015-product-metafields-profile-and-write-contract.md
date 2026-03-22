# ADR-0015 Product metafields profile and write contract

- Status: Accepted
- Date: 2026-03-15
- Owners: Codex

## Context
`PD-008` では product metafields を Product Domain Parity MVP に追加する。既存 truth は `product-core-seo-v1`、`product-variants-v1`、`product-variants-prices-v1`、`product-inventory-v1`、`product-media-v1` の export/preview/write contract に固定されている。
product metafields は product core fields と別の row identity と write mutation (`metafieldsSet`) を持ち、既存 core profile に列を足すと exact header contract を壊す。

また technical spec は `metafieldsSet`、25 件 chunk、supported types の subset、definition UI は later を固定しているが、launch v1 の subset、create/update 条件、delete 非対応、unsupported type の見せ方まではまだ明文化されていない。

## Decision
- product metafields は既存 profile を拡張せず、新 profile `product-metafields-v1` として追加する。
- SEO は既存 `product-core-seo-v1` contract に残し、`PD-008` では regression のみを扱う。
- launch v1 の metafields scope は **product owner の全 namespace** を対象にする。ただし export / preview / write 対象は supported type subset のみとする。
- supported type subset は `single_line_text_field`、`multi_line_text_field`、`boolean`、`number_integer`、`number_decimal` に固定する。
- `product-metafields-v1` の canonical CSV header は `product_id,product_handle,namespace,key,type,value,updated_at` に固定する。
- row identity は `product_id + namespace + key` とする。`updated_at` は read-only 診断列であり、drift 判定や changed field には使わない。
- source row が edited CSV から欠落しても delete とは解釈しない。欠落行は no-op とする。
- blank value による clear/delete は launch v1 では扱わない。blank value は preview error にする。
- current に row が存在しない場合でも、CSV に explicit `type` があり、その type が supported subset に含まれていれば create を許可する。
- current に row が存在する場合は update を許可するが、既存 type と edited type が一致しない type change は preview error にする。
- export/read は product metafields connection を cursor pagination で最後まで取得した後、supported type filter を掛ける。
- unsupported type は CSV に出力しない。代わりに export artifact metadata に `skippedMetafieldsCount` と `skippedMetafieldTypes` を残す。
- preview は baseline/current/edited を row identity で比較し、baseline と current の不一致、baseline 不在で current のみ存在する row は warning とする。
- write は `metafieldsSet` を使い、25 rows 以下の chunk 単位で送る。compare-and-set は導入せず、confirm 直前 revalidation と final-state verification を truth にする。
- success truth は final-state verification とし、write 後に live metafields を再読込して canonicalized `type/value` が一致した row のみ verified success とする。
- metafields profile でも `product.write.snapshot` artifact は作成する。ただし rollbackable write には含めない。

## Consequences
- product metafields を既存 profile contract を壊さずに追加できる。
- launch v1 の supported type、create 条件、delete 非対応が明文化される。
- unsupported type を silent omission ではなく metadata / warning として可視化できる。

## Alternatives considered
- `product-core-seo-v1` に metafields 列を追加する案
  exact header contract を壊すため不採用。
- all metafield types を一括対応する案
  JSON や complex type の canonical compare と validation が広がりすぎるため不採用。
- row omission を delete semantics にする案
  `metafieldsSet` 単体では delete できず、launch v1 の安全性と closed-loop preview contract を崩すため不採用。

## References
- `tickets/product-domain/PD-008-product-metafields-and-seo.md`
- `docs/shopify_app_technical_spec_complete.md` (Section 4.5)
- `adr/0005-product-domain-parity-mvp-boundary.md`
