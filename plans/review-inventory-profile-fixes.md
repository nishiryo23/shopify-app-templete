# review-inventory-profile-fixes plan

## Goal
inventory review の P1/P2 を root cause ベースで修正し、inventory preview/write contract と Shopify read path を repo truth・Shopify docs に一致させる。

## Read first
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0013-product-inventory-profile-and-write-contract.md`
- `plans/PD-006-inventory-pipeline.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/SKILL.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-fix/SKILL.md`

## Constraints
- inventory launch scope は active inventory level に対する `available` absolute set のまま維持する。
- `shopify.app.toml`、scope、billing、webhook policy は変更しない。
- write success truth は final-state verification のまま維持する。
- remediation と readiness は混ぜない。

## Steps
1. inventory preview で `variant_id` / `location_id` を read-only identity 列として強制し、retarget を preview error にする。
2. Shopify inventory reader を inventoryLevels pagination 対応にし、250 超 location の variant でも export/preview できるようにする。
3. contract tests を追加し、ADR/plan の 250 超 stable error 前提を削除する。
4. `pnpm check` を実行し、失敗があれば修正する。

## ADR impact
- ADR required: yes
- ADR: 0013
- Why: inventory read contract の source-of-truth が「250 超は error」から「Shopify pagination を追う」に変わるため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`

## Risks / open questions
- inventoryLevels pagination は variant ごとに追うため、location 数が非常に多い shop では read コストが増える。
- launch scope 外の location activation / tracked 切り替えは引き続き未対応。
