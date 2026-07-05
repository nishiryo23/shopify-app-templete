# P-010 plan

## Goal
entitlement truth を Admin API `currentAppInstallation` から Partner API `activeSubscription(appId, shopId)` に移行し、billing 参照を DB スナップショット + TTL resolver 経由へ統一する。

## Read first
- `AGENTS.md`
- `docs/template_scope.md`
- `docs/platform-truth-index.md`
- `.agents/skills/billing-entitlement/SKILL.md`
- `tickets/README.md`
- `tickets/platform/P-010-partner-api-billing-truth.md`
- `adr/0003-managed-pricing-as-billing-source-of-truth.md`
- `app/services/billing.server.ts`
- `domain/billing/managed-pricing-url.mjs`
- `.agent/PLANS.md`

## Constraints
- `shopify.app.toml`、access scope、webhook subscription topic は変更しない。
- UI/コピー/plan selection CTA の見た目は変更しない。
- Partner API token は `PARTNER_API_ACCESS_TOKEN` を新規必須 env とし、未設定時の refresh は fail-fast する。ただし resolver は既存 DB snapshot があれば fallback して主要フローを止めない。
- 有料判定は plan handle allowlist のみを paid truth に使う。subscription status 単体では `ACTIVE_PAID` にしない。
- 公開 plan handle の既定値と `BILLING_TEST_PLAN_HANDLES` の追加値を allowlist とする。
- plan selection 戻りは `plan_handle` + `shop` の組み合わせだけを強制 refresh trigger とし、`charge_id` は使わない。
- 新規 package は追加しない。Node/既存依存だけで実装する。

## Steps
1. ADR-0027 を追加し、ADR-0003 冒頭に superseded 注記を追記する。
2. Prisma schema と billing domain に Partner API client / entitlement resolver / allowlist 判定を追加し、既存の `currentAppInstallation` entitlement helper を置換する。
3. `app/services/billing.server.ts` と welcome/refresh route の参照点を resolver 経由に統一し、plan selection 戻り時だけ TTL を無視して refresh する。
4. `.env.example` と docs/truth index の billing 参照を新設計へ更新する。
5. contract test を追加/更新し、resolver 統一、allowlist 判定、fallback、強制 refresh、`currentAppInstallation` 残存なしを検証する。
6. `tickets/README.md` の P-010 status を `done` に更新し、`pnpm check` を実行する。

## ADR impact
- ADR required: yes
- ADR: 0027
- Why: billing source-of-truth と route contract を変更するため。ADR-0003 の `currentAppInstallation` truth を旧仕様として明示的に置換する必要がある。

## Validation
- `node --test tests/contracts/billing-routes.contract.test.mjs`
- 追加する billing resolver contract
- `pnpm check`

## Risks / open questions
- Partner API token の実値発行は out of scope。未設定時の refresh は fail-fast し、snapshot fallback の有無でフロー継続可否が分かれる。
- 公開 plan handle の既定値はテンプレの既存単一プラン名に対応する値へ固定し、派生 app の追加 handle は `BILLING_TEST_PLAN_HANDLES` で明示する。
