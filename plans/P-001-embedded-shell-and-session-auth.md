# P-001 embedded shell and session auth plan

## Goal
`shopify app dev` で起動できる最小の public embedded app scaffold を追加し、`/app`、`/app/pricing`、`/app/welcome` の shell と session-token based auth 境界を用意する。

## Read first
- `tickets/platform/P-001-embedded-shell-and-session-auth.md`
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/shopify-lifecycle/SKILL.md`
- `adr/0002-embedded-auth-and-token-exchange.md`
- Shopify React Router template

## Constraints
- managed install + embedded auth を前提にする
- cookie-only auth を導入しない
- direct Admin API access は使わない
- billing truth / product jobs は今回入れない

## Steps
1. Shopify CLI / official template をもとに最小 app scaffold と config を追加する
2. `/app`、`/app/pricing`、`/app/welcome` と auth route を実装する
3. invalid session の XHR/document boundary を smoke/contract 前提に揃える
4. 依存関係を導入して `pnpm check` と app-level type/build を確認する

## ADR impact
- ADR required: yes
- ADR: 0002
- Why: embedded auth boundary と token exchange 前提の設計判断を更新するため。

## Validation
- `pnpm check`
- `pnpm run typecheck`
- `pnpm run build`
- `shopify app dev` の preflight 到達確認

## Risks / open questions
- 実際の dev preview 起動には Partner app / client id / login 済み環境が必要
- scope truth と offline token bootstrap は P-002 で確立するため、今回は最小 config にとどめる
