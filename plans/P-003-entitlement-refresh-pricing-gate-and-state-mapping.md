# P-003 entitlement refresh, pricing gate, and state mapping plan

## Goal
Managed App Pricing の hosted flow を前提に、`currentAppInstallation` を billing truth とする entitlement refresh と pricing gate を実装する。

## Read first
- `tickets/platform/P-003-entitlement-refresh-pricing-gate-and-state-mapping.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0003-managed-pricing-as-billing-source-of-truth.md`
- `.agents/skills/billing-entitlement/SKILL.md`
- `app/routes/app.pricing.tsx`
- `app/routes/app.welcome.tsx`
- `domain/billing/entitlement-state.mjs`
- `tests/contracts/billing-entitlement.contract.test.mjs`

## Constraints
- billing truth は redirect や webhook 到着ではなく `currentAppInstallation` query に置く。
- `/app/welcome` は遷移トリガーに使えても、それ自体で entitlement 付与済み扱いにしない。
- `shopify.app.toml`、scope、managed pricing truth、webhook policy はこの ticket で変更しない。
- product domain 実装には進めず、対象は pricing shell / welcome shell / billing refresh 境界に限定する。
- direct Admin API access や off-platform billing は導入しない。

## Steps
1. `authenticate.admin` 配下で `currentAppInstallation` を取得する billing query service を追加し、`ACTIVE` / `PENDING` / `ACCEPTED` / `FROZEN` / terminal statuses を local entitlement state に正規化する。
2. billing query service の結果を返す refresh endpoint を追加し、welcome 導線と pricing shell が同じ entitlement truth を参照できるようにする。
3. `/app/pricing` を最小 shell から pricing gate へ更新し、`NOT_ENTITLED` と `PENDING_APPROVAL` と `PAYMENT_HOLD` と `ACTIVE_PAID` で表示と遷移先を分ける。
4. `/app/welcome` を managed install 後の説明画面として更新し、refresh trigger は持たせつつ entitlement 付与の source-of-truth にはしない。
5. contract/integration/smoke を追加または更新し、status mapping、pricing gate、welcome 非付与、refresh flow を固定する。

## ADR impact
- 既存 `adr/0003-managed-pricing-as-billing-source-of-truth.md` を正本とし、state mapping や refresh trigger の扱いに差分が出る場合のみ更新する。

## Validation
- `pnpm check`
- `node --test tests/contracts/billing-entitlement.contract.test.mjs`
- pricing shell smoke を `SMOKE_PRICING_URL` で確認
- welcome link 単体で entitlement が付与されないことを手動確認

## Risks / open questions
- `currentAppInstallation` のレスポンス shape は実装前に Shopify 公式ドキュメントで再確認する。特に managed pricing の status enum と line item の取り出し方を固定する。
- local DB に entitlement snapshot を持つか、その場 query-only にするかは未確定。ADR-0003 の「query-based truth」を壊さない範囲で、UI 応答性のための cache を置く場合も refresh endpoint を正本にする。
- `P-004` 相当の webhook 断面は一部先行実装済みだが、`app_subscriptions/update` を entitlement truth に昇格させない。
