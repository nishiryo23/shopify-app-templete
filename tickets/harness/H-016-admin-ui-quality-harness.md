# H-016 Admin UI quality harness

## Objective
管理画面 UI の品質規約（Polaris baseline・状態設計・コピー集約・testid 規約）をハーネス化し、参照実装と contract test で機械検証できるようにする。

## Read first
- `docs/platform-truth-index.md`
- `adr/0022-polaris-admin-ui-baseline-and-conventions.md`
- `.agents/skills/polaris-admin-ui/SKILL.md`
- `tests/smoke/embedded-shell.spec.mjs`（`data-testid="app-shell"` 依存）

## Scope
- `.agents/skills/polaris-admin-ui/SKILL.md` の新設
- `docs/admin-ui-guidelines.md` の新設と `docs/platform-truth-index.md` の索引更新
- `/app` ホーム（`app/routes/app._index.tsx`）の参照実装化（entitlement サマリー + セットアップガイド + loading / error 状態の実演）
- `app/routes/auth.login.tsx` の Polaris 化（インライン style 排除）
- `tests/contracts/admin-ui-conventions.contract.test.mjs` の新設
- `.agents/skills/domain-feature-stub/SKILL.md` / `.agent/PLANS.md` への UI acceptance criteria 追記

## Out of scope
- Polaris web components への移行（ADR-0022 の Alternatives に将来 ticket として記録）
- i18n（UI 文言は日本語固定のまま）
- billing truth / route contract の変更（`app/services/billing.server.ts` は変更しない）

## ADR impact
Create `adr/0022-polaris-admin-ui-baseline-and-conventions.md`.

## Acceptance
- 管理画面 UI route にインライン style / hex 直書き / 生 HTML コントロールが存在しないことを contract が検証する
- `/app` ホームが loading（Skeleton）/ error（Banner）/ entitlement 状態サマリーを実演する
- `data-testid="app-shell"` を維持し既存 smoke が通る
- UI 文言が `app/utils/admin-copy.ts` に集約されている
- `PolarisProvider` を持つ route が `app.tsx` と `auth.login.tsx` のみであることを contract が検証する

## Validation
- `node --test tests/contracts/admin-ui-conventions.contract.test.mjs`
- `pnpm check`
