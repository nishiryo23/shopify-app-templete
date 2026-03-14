# ADR-0011 Product variants profile and write contract

- Status: Accepted
- Date: 2026-03-14
- Owners: Codex

## Context
`PD-004` では variants create/update/delete を Product Domain Parity MVP に追加するが、既存 truth は `product-core-seo-v1` の export/preview/write/undo に固定されている。variants は `productUpdate` で扱えず、Shopify の variant-specific mutation 群を使う必要があるため、profile schema、preview baseline binding、write orchestration、rollbackable lookup の扱いを別途固定しないと既存 `PD-001`〜`PD-003` と衝突する。

## Decision
- variant workflow は既存 `product-core-seo-v1` を拡張せず、新 profile `product-variants-v1` として追加する。
- export route は `profile` を受け付けるが、write/verify の profile truth は completed preview artifact の `profile` を正本にする。`/app/product-writes` は `profile` を受け付けない。
- `product-variants-v1` の canonical CSV header は `command,product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,sku,barcode,taxable,requires_shipping,inventory_policy,updated_at` に固定する。
- `command` は `UPDATE|CREATE|DELETE`。空欄は `UPDATE` と同義。
- `PD-004` は既存 product option 構造に対する variant 操作のみ対応する。option 軸追加、option name 変更、option reorder は対象外とし、preview error にする。
- create row は variant baseline を持たないため `baselineRow: null` と `sourceRowNumber: null` を許可するが、selected export baseline に `product_id` 自体が存在することを必須にする。
- create row は `product_id + option value tuple` が edited CSV、baseline、live Shopify state のいずれかで重複する場合は preview error にする。
- write stage は product 単位に `create -> update -> delete` の順で実行する。create は `productVariantsBulkCreate`、update は `productVariantsBulkUpdate` + `allowPartialUpdates: true`、delete は row-level outcome を曖昧にしないため `1 row = 1 productVariantsBulkDelete` call に固定する。
- managed field は `option*_value`, `sku`, `barcode`, `taxable`, `requires_shipping`, `inventory_policy` のみとし、price/compare-at は `PD-005`、inventory quantity は `PD-006` に委ねる。
- final-state verification を success truth にする。create は mutation response の created variant id を保存してその id で verify、update は `variant_id` の managed field 一致、delete は `variant_id` が live state から消えていることを verify する。
- variant write は rollbackable write に含めない。`product-variants-v1` の result artifact には `metadata.profile` を持たせるが、rollbackable lookup に必要な `snapshotArtifactId` は metadata に載せず、undo UI も variant profile では出さない。

## Consequences
- variants は既存 product core write/undo truth を壊さずに別 profile として追加できる。
- create row の baseline なしケースを許容しつつ、closed-loop preview の product-level binding は維持できる。
- update は partial failure を row-level に表現でき、delete は性能より outcome の明確性を優先できる。
- variant write が latest rollbackable write lookup に混ざらず、既存 undo surface を壊さない。
- price / compare-at の追加は `ADR-0012` で別 profile contract として拡張できる。

## Alternatives considered
- `product-core-seo-v1` を variants で拡張する案
  既存 export/preview/write contract を壊し、`PD-001`〜`PD-003` の artifact truth と両立しにくいため不採用。
- variant write も rollbackable write に含める案
  create/delete rollback の contract が `PD-004` の範囲を超えるため不採用。
- delete も bulk mutation でまとめる案
  row-level outcome と error mapping が曖昧になるため不採用。

## References
- `tickets/product-domain/PD-004-variants-pipeline.md`
- `adr/0012-product-variant-prices-profile-and-write-contract.md`
- `adr/0008-product-export-route-and-artifact-contract.md`
- `adr/0009-product-preview-route-and-provenance-contract.md`
- `adr/0010-product-write-verify-and-undo-contract.md`
- `https://shopify.dev/docs/api/admin-graphql/latest/mutations/productVariantsBulkCreate`
- `https://shopify.dev/docs/api/admin-graphql/latest/mutations/productVariantsBulkUpdate`
- `https://shopify.dev/docs/api/admin-graphql/latest/mutations/productVariantsBulkDelete`
