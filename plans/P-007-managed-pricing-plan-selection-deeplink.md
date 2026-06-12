# P-007 managed pricing plan-selection deep link plan

## Goal
pricing 画面に Managed Pricing plan selection への deep link CTA を追加し、未契約 merchant の課金導線を閉じる。

## Read first
- `tickets/platform/P-007-managed-pricing-plan-selection-deeplink.md`
- `adr/0003-managed-pricing-as-billing-source-of-truth.md`
- `tests/contracts/billing-routes.contract.test.mjs`（既存 assert を壊さない）
- `.agents/skills/polaris-admin-ui/SKILL.md`

## Constraints
- entitlement truth（`currentAppInstallation` query）と refresh contract を変えない
- welcome route は変更しない（`charge_id|searchParams|URLSearchParams` 禁止 assert）
- route は `domain/` を直接 import しない。URL は service 経由の loader data で渡す
- `SHOPIFY_APP_HANDLE` は optional。未設定で dev / CI が壊れない

## Steps
1. `domain/billing/managed-pricing-url.mjs` に `derivePlanSelectionUrl` を実装する
2. `app/services/billing.server.ts` の gate loader data に `planSelectionUrl` を追加する
3. `app/routes/app.pricing.tsx` に状態別 CTA（`pricing-plan-selection-cta`、`target="_top"`）を追加する
4. `SHOPIFY_APP_HANDLE` を `.env.example` / deploy workflow / web task definition に配線する
5. contract test を追加し、ADR-0003 / skill / truth index / smoke checklist を更新する
6. `pnpm check` を実行する

## ADR impact
- ADR required: yes
- ADR: 0003
- Why: plan selection deep link を trigger only として billing truth に追記し、app handle のランタイム truth を新設するため。

## Validation
- `node --test tests/contracts/billing-routes.contract.test.mjs tests/contracts/aws-infra-bootstrap.contract.test.mjs`
- `pnpm check`
- dev store 手動 smoke（CTA → plan selection → 承認 → refresh）

## Risks / open questions
- 埋め込み iframe からの top-level 遷移は App Bridge v4 が `target="_top"` / `window.open(url, "_top")` を仲介する想定。実機 dev store での遷移確認を受入条件とする
- custom domain ショップでは CTA を出さない（安全側）。必要になれば別 ticket で対応する
