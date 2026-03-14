# PD-004 Variants pipeline plan

## Goal
`product-variants-v1` profile を追加し、variants create/update/delete の export/preview/write/verify を既存 `/app/preview` 導線に統合する。

## Read first
- `tickets/product-domain/PD-004-variants-pipeline.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0008-product-export-route-and-artifact-contract.md`
- `adr/0009-product-preview-route-and-provenance-contract.md`
- `adr/0010-product-write-verify-and-undo-contract.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy は変更しない。
- `PD-004` は variants create/update/delete のみ。price/compare-at、inventory quantity、media、product option 自体の追加変更は含めない。
- `product-core-seo-v1` は既存のまま残し、variant は別 profile `product-variants-v1` として追加する。
- write/verify の profile truth は completed preview artifact の `profile` を正本にし、`/app/product-writes` は `profile` を受け付けない。
- variant write は rollbackable write に含めず、undo は `product-core-seo-v1` のみ維持する。

## Steps
1. `adr/0011-product-variants-profile-and-write-contract.md` を追加し、variant profile schema、profile-aware route truth、create/update/delete preview/write/verify contract を固定する。
2. export profile / export worker / Shopify reader に `product-variants-v1` を追加し、variant CSV source/manifest artifact を生成できるようにする。
3. variant preview parser / diff / digest / baseline binding を追加し、`CREATE` row の `baselineRow: null`、baseline product 必須、tuple collision reject を実装する。
4. Shopify variant preview/write platform module を追加し、product 単位 `create -> update -> delete` orchestration、`allowPartialUpdates: true`、delete single-row mutation、final-state verification を実装する。
5. `/app/preview`、export route、preview/write service を profile-aware に更新し、profile selector と selected profile 用 `Create export` button を統合する。
6. variant write を rollbackable lookup から除外し、undo UI が variant profile で出ないように既存 latest write 読み出しを調整する。
7. contract tests / smoke を更新し、`pnpm check` が通るまで修正する。

## ADR impact
- ADR required: yes
- ADR: 0011
- Why: variant profile schema、profile-aware route truth、create/update/delete write/verify contract が新しい source-of-truth になるため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- export / preview / write / latest-write contract tests
- preview shell smoke list

## Risks / open questions
- delete を 1 row = 1 mutation call に固定するため、性能より row-level outcome の明確性を優先する。
- create row は variant baseline を持たないが、selected export baseline に product 自体が存在することは必須にする。
- variant write は rollbackable metadata を持たせず、undo は別 ticket で扱う。
