# PD-009 Manual collections membership plan

## Goal
`product-manual-collections-v1` profile を追加し、manual collection membership の export / preview / write / verify を既存 pipeline に統合する。

## Read first
- `tickets/product-domain/PD-009-manual-collections-membership.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract は変更しない。
- scope は manual collection membership の export / preview / write / verify のみ。
- smart collections、collection create/update、undo、collection catalog export はこの ticket では扱わない。
- write queue の `maxAttempts: 1` は維持し、自動 retry を入れない。
- success truth は mutation 完了ではなく async job 完了後の post-verification read とする。

## Steps
1. `adr/0016-product-manual-collections-profile-and-write-contract.md` を追加し、profile 名、CSV header、row identity、handle 解決、manual-only 制約、write/verify truth を固定する。
2. requirements / technical spec を更新し、manual collections write strategy と nested pagination を明文化する。
3. `domain/collections` と `platform/shopify/product-collections.server.mjs` を追加し、export/read/write helper を実装する。
4. export / preview / write workers、profile registry、preview UI selector を更新する。
5. contract tests と smoke を追加し、`pnpm check` が通るまで修正する。

## ADR impact
- ADR required: yes
- ADR: 0016
- Why: manual collections profile、CSV contract、handle resolution、async job polling、post-verification read が新しい source-of-truth になるため。

## Validation
- `pnpm check`
- contract tests
- preview shell smoke
- schema/doc validation for `collectionAddProductsV2` / `collectionRemoveProducts` / `Job.done`

## Risks / open questions
- Shopify docs 上の mutation version 差分は、technical spec と ADR に固定して drift を防ぐ。
- merchant-known handle 前提は UX 制約として受け入れ、collection picker は later とする。
