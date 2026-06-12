# P-007 Managed pricing plan-selection deep link

## Objective
未契約 merchant が pricing 画面から Managed Pricing の plan selection ページへ到達できる導線を追加する。

## Read first
- `docs/platform-truth-index.md`
- `.agents/skills/billing-entitlement/SKILL.md`
- `.agents/skills/polaris-admin-ui/SKILL.md`
- `adr/0003-managed-pricing-as-billing-source-of-truth.md`

## Scope
- `domain/billing/managed-pricing-url.mjs`（plan selection URL の純粋関数）
- `app/services/billing.server.ts` の loader data に `planSelectionUrl` を追加
- `/app/pricing` の状態別 CTA（`pricing-plan-selection-cta`）
- `SHOPIFY_APP_HANDLE` env の配線（`.env.example` / deploy workflow / web task definition）

## Out of scope
- welcome route の変更（既存の「料金画面を開く」導線を維持）
- entitlement mapping / refresh contract の変更
- shopify.app.toml への handle 追記（CLI 管理フィールドとの二重化を避ける）

## ADR impact
Update `adr/0003-managed-pricing-as-billing-source-of-truth.md`（deep link は trigger only、app handle truth）。

## Acceptance
- `SHOPIFY_APP_HANDLE` 設定時、pricing 画面に状態別ラベルの plan selection CTA が表示され、top-level で admin の plan selection へ遷移する
- `SHOPIFY_APP_HANDLE` 未設定・custom domain では CTA を描画しない
- deep link 遷移自体は entitlement を変えない（truth は query のまま）
- 既存の pricing contract assert（loadPricingGate / refresh 導線 / 正本コピー）を維持する

## Validation
- `node --test tests/contracts/billing-routes.contract.test.mjs tests/contracts/aws-infra-bootstrap.contract.test.mjs`
- `pnpm check`
- dev store 手動 smoke: 未契約 → CTA → plan 選択 → 承認 → 「状態を再確認」で ACTIVE_PAID（`docs/dev-store-smoke-checklist.md`）
