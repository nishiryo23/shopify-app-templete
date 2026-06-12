# H-016 admin UI quality harness plan

## Goal
管理画面 UI の品質規約を skill / docs / 参照実装 / contract test としてハーネス化し、AI が倣う UI の正本を作る。

## Read first
- `tickets/harness/H-016-admin-ui-quality-harness.md`
- `adr/templates/ADR_TEMPLATE.md`
- `tests/contracts/platform-premises-doc-parity.contract.test.mjs`（docs 追加要件）
- `tests/contracts/auth-login-route.contract.test.mjs` / `tests/contracts/app-home-route.contract.test.mjs`
- `tests/smoke/embedded-shell.spec.mjs`

## Constraints
- `app/services/billing.server.ts` と welcome / pricing route は変更しない
- `data-testid="app-shell"` と auth.login の `runAuthLoginLoader` / `runAuthLoginAction` 委譲を維持する
- route は `domain/` を直接 import しない（guardrails）
- `docs/admin-ui-guidelines.md` の `truth_sources` に platform-premises fixture を入れない（doc parity の本文同期が発動するため）

## Steps
1. ADR-0022 を作成し Polaris React baseline と UI 規約の正本配置を固定する
2. `.agents/skills/polaris-admin-ui/SKILL.md` と `docs/admin-ui-guidelines.md` を新設し、truth index の表に行を追加する
3. `loadAppHome` を `app/services/app-shell.server.ts` に追加し、`app._index.tsx` を参照実装化する
4. `auth.login.tsx` をスタンドアロン PolarisProvider で Polaris 化する
5. `tests/contracts/admin-ui-conventions.contract.test.mjs` を追加し、domain-feature-stub / PLANS テンプレに UI acceptance を追記する
6. `pnpm check` を実行して gate を確認する

## ADR impact
- ADR required: yes
- ADR: 0022
- Why: 管理画面 UI の baseline を Polaris React に固定し、UI 規約を contract で機械検証する設計判断を新設するため。

## Validation
- `node --test tests/contracts/admin-ui-conventions.contract.test.mjs`
- `node --test tests/contracts/auth-login-route.contract.test.mjs tests/contracts/app-home-route.contract.test.mjs tests/contracts/platform-premises-doc-parity.contract.test.mjs`
- `pnpm check`

## Risks / open questions
- Polaris web components への移行は今回判断しない（ADR-0022 Alternatives に記録）
- コピーの「完全」集約や empty state の網羅は regex で安全に検証できないため contract に入れず skill / docs の規範に留める
