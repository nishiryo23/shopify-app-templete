# ADR-0013 Product inventory profile and write contract

- Status: Accepted
- Date: 2026-03-14
- Owners: Codex

## Context
`PD-006` では inventory quantity 更新を Product Domain Parity MVP に追加するが、既存 truth は `product-core-seo-v1`、`product-variants-v1`、`product-variants-prices-v1` の export/preview/write contract に固定されている。  
inventory は location ごとの row identity と compare-and-set write を持つ別 mutation 系統であり、variant profile に列を足すと exact header contract と artifact truth を壊す。

また、launch scope 文書には inventory が含まれていた一方で tracked/untracked や location activation まで含むかが曖昧だった。`PD-006` の ticket objective と既存 pipeline の粒度に合わせ、launch v1 の inventory scope を active inventory level の quantity-only に固定し直す必要がある。

## Decision
- inventory は既存 profile を拡張せず、新 profile `product-inventory-v1` として追加する。
- launch v1 の inventory scope は **active inventory level に対する `available` quantity absolute set** に固定する。
- tracked/untracked、new location activation/deactivation、inventory adjust、scheduled inventory は launch v1 から外し later とする。
- `product-inventory-v1` の canonical CSV header は `product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,location_id,location_name,available,updated_at` に固定する。
- row identity は `variant_id + location_id` とし、`product_id` は ownership verify 用の必須列とする。
- writable field は `available` のみ。`product_handle`、`option*_name`、`option*_value`、`location_name`、`updated_at` は read-only とする。
- `variant_id` と `location_id` は row identity そのものとして read-only とし、edited CSV で baseline row を別 identity に retarget する変更は preview error にする。
- `available` は signed integer のみ許可する。blank、decimal、exponent、thousands separator は preview error にする。
- export/read は baseline に存在する active inventory level のみ対象にする。write も baseline row が存在する location のみ許可し、未出現 location は preview error にする。
- inventory level read は Shopify GraphQL connection pagination を追従し、variant ごとに active inventory levels を最後の page まで取得する。
- write mutation は `inventorySetQuantities` を使い、`name: "available"`、`reason: "correction"`、`referenceDocumentUri: "gid://matri/ProductPreview/<previewJobId>"` を固定する。
- compare-and-set は `changeFromQuantity` を標準動作とし、confirm 直前 revalidation で読んだ live quantity を送る。stale quantity は row conflict 扱いにする。
- `inventorySetQuantities` は `@idempotent` directive を付け、chunk ごとに UUID を発行する。
- write は 250 rows 以下の chunk 単位で送る。
- inventory profile でも `product.write.snapshot` artifact は作成し、result payload に `snapshotArtifactId` を残す。ただし rollbackable write には含めない。
- success truth は final-state verification とし、write 後に live inventory level を再読込して edited `available` と一致した row のみ verified success とする。

## Consequences
- inventory を既存 profile contract を壊さずに追加できる。
- launch scope の inventory 定義が quantity-only として明文化され、tracked/location activation の ambiguity が消える。
- compare-and-set conflict、idempotency、snapshot/verify truth を row-level に固定できる。

## Alternatives considered
- `product-variants-v1` に inventory quantity 列を追加する案
  exact header contract と既存 artifact truth を壊すため不採用。
- tracked/untracked と location activation を同 ticket に含める案
  row identity、baseline semantics、UI contract が広がりすぎ、`PD-006` の粒度を超えるため不採用。
- inventory profile では snapshot artifact を作らない案
  既存 non-rollbackable profile の invariant から外れ、監査・障害解析の正本を失うため不採用。

## References
- `tickets/product-domain/PD-006-inventory-pipeline.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
