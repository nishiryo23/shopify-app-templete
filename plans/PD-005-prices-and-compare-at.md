# PD-005 Prices and compare-at plan

## Goal
`product-variants-prices-v1` profile を追加し、variant price / compare-at の export / preview / write / verify を既存 pipeline に統合する。

## Read first
- `tickets/product-domain/PD-005-prices-and-compare-at.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `adr/0011-product-variants-profile-and-write-contract.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy は変更しない。
- `PD-005` は prices / compare-at のみ。inventory、markets/B2B pricing、variant create/delete 混在 workflow は含めない。
- `product-variants-v1` は破壊変更しない。price 対応は新 profile `product-variants-prices-v1` で追加する。
- `compare_at_price` 空欄は clear、`price` 空欄変更は preview/write error にする。
- write success truth は final-state verification のまま維持する。

## Steps
1. `adr/0012-product-variant-prices-profile-and-write-contract.md` を追加し、新 profile、money normalization、preview/write/verify contract を固定する。
2. `docs/shopify_app_technical_spec_complete.md` を更新し、stage 4 を price profile の独立 stage として明文化する。
3. export profile / Shopify variant read/export query に `price` / `compareAtPrice` を追加し、新 profile の source CSV と manifest を生成できるようにする。
4. price profile 用 preview parser / diff / digest / validation を追加し、`variant_id` / `product_id` 整合、read-only columns、money validation を実装する。
5. price profile 用 write builder / worker を追加し、`productVariantsBulkUpdate`、revalidation、final-state verification を実装する。
6. preview UI と export/preview/write service の profile dispatch を更新し、undo gating は core profile のみ維持する。
7. contract + integration tests を追加し、`pnpm check` が通るまで修正する。

## ADR impact
- ADR required: yes
- ADR: 0012
- Why: new export profile、money normalization、price-specific preview/write/verify contract が新しい source-of-truth になるため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- product export / preview / write contract tests
- price profile route/service contract assertions

## Risks / open questions
- variant create/delete と price 更新を 1 CSV に混在させる unified workflow は今回扱わない。
- decimal canonicalization は文字列正規化で扱い、markets / currency conversion には広げない。
