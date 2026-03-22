# ADR-0012 Product variant prices profile and write contract

- Status: Accepted
- Date: 2026-03-14
- Owners: Codex

## Context
`PD-005` では variant の price / compare-at を Product Domain Parity MVP に追加するが、既存 truth は `product-variants-v1` の create/update/delete contract に固定されている。`product-variants-v1` の CSV header を直接拡張すると `PD-004` で固定した exact header contract、fixture、baseline artifact truth を壊す。  
一方で launch scope には prices / compare-at が含まれており、preview / write / verify まで含めた closed-loop workflow を追加する必要がある。

## Decision
- prices / compare-at は既存 `product-variants-v1` を拡張せず、新 profile `product-variants-prices-v1` として追加する。
- `product-variants-prices-v1` の canonical CSV header は `product_id,product_handle,variant_id,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,price,compare_at_price,updated_at` に固定する。
- この profile は update-only とし、`command` 列は持たない。variant create/delete は `product-variants-v1` に残す。
- read-only columns は `product_handle`, `option*_name`, `option*_value`, `updated_at` とする。edited row が baseline と一致しない場合は preview error にする。
- `variant_id` と `product_id` は必須とし、baseline/live state で `variant_id` が属する product と edited `product_id` が一致しない場合は preview error にする。
- money 値は trim 後に `^\d+(\.\d{1,2})?$` のみ許可する。負数、指数表記、桁区切りは受け付けない。
- money の canonical form は整数部の先頭ゼロと少数部末尾ゼロを除去した文字列とし、verify は canonical equality で判定する。`10` と `10.00` は同値扱いにする。
- `price` の空欄変更は invalid update とする。`compare_at_price` の空欄は clear とみなし、write 時は `compareAtPrice: null` を送る。
- write stage は `productVariantsBulkUpdate` を使い、changed fields のみ mutation input に含める。
- final-state verification を success truth にする。`price` / `compare_at_price` の changed fields が canonical equality で一致した row のみ verified success とみなす。
- `product-variants-prices-v1` も rollbackable write には含めず、undo surface は `product-core-seo-v1` のみ維持する。

## Consequences
- `PD-004` の variant contract を壊さずに prices / compare-at を追加できる。
- price clear / compare-at clear の semantics と verify truth を row-level で明確にできる。
- variant create/delete と price 更新の mixed workflow は今回の scope 外として明示される。

## Alternatives considered
- `product-variants-v1` を price columns で拡張する案
  exact header contract と既存 baseline fixture を壊すため不採用。
- `price` と `compare_at_price` の空欄を両方 clear 可能にする案
  blank price の意味が曖昧で row-level error mapping も弱くなるため不採用。
- `price` 更新も rollbackable write に含める案
  rollback contract の拡張が `PD-005` の範囲を超えるため不採用。

## References
- `tickets/product-domain/PD-005-prices-and-compare-at.md`
- `adr/0011-product-variants-profile-and-write-contract.md`
- `docs/shopify_app_technical_spec_complete.md`
