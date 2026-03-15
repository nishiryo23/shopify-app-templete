# PD-006 Inventory pipeline plan

## Goal
`product-inventory-v1` profile を追加し、active inventory level に対する `available` quantity の export / preview / write / verify を既存 pipeline に統合する。

## Read first
- `tickets/product-domain/PD-006-inventory-pipeline.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Constraints
- `shopify.app.toml`、billing truth、webhook policy は変更しない。
- `PD-006` は active inventory level に対する `available` quantity absolute set のみ。tracked/untracked、location activation、inventory adjust、scheduled inventory は含めない。
- write success truth は final-state verification のまま維持する。
- inventory profile は snapshot artifact を持つが rollbackable write には含めない。
- Shopify mutation は `inventorySetQuantities` + `@idempotent` + `changeFromQuantity` を使い、`reason` は `correction` に固定する。

## Steps
1. `adr/0013-product-inventory-profile-and-write-contract.md` を追加し、launch boundary の quantity-only inventory、CSV header、location identity、chunking、idempotency、snapshot/verify contract を固定する。
2. requirements / technical spec / ADR-0005 を更新し、launch inventory scope を active inventory level の quantity-only に揃える。
3. export profile と inventory CSV builder、Shopify inventory reader を追加し、variant × active location ごとの source CSV と manifest を生成できるようにする。
4. inventory preview parser / diff / digest / validation を追加し、`variant_id + location_id` identity、read-only columns、integer validation、live drift warning を実装する。
5. inventory write builder / worker を追加し、`inventorySetQuantities`、250-row chunking、`@idempotent`、snapshot artifact、final-state verification を実装する。
6. export / preview / write services、workers、preview UI の profile dispatch を更新し、undo gating は core profile のみ維持する。
7. contract tests を追加し、`pnpm check` が通るまで修正する。

## ADR impact
- ADR required: yes
- ADR: 0013
- Why: launch inventory scope の縮約、new export profile、location identity、Shopify inventory mutation contract が新しい source-of-truth になるため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- product export / preview / write contract tests
- inventory profile route/service/worker assertions

## Risks / open questions
- active inventory level が多い variant では read-side GraphQL cost が増えるため、export/preview worker の lease と retry 設計を維持して運用する。
- `referenceDocumentUri` は app 固有 URI に固定し、merchant editable な document URI までは扱わない。
