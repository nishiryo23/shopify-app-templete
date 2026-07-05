# P-009-growth-kit plan

## Goal
テンプレート本体に Growth Kit v1 を追加し、レビュー依頼、オンボーディングチェックリスト、ファネル計測、アンインストール計測、リスティング資産正本を fork 後の設定差し替えだけで使える状態にする。

## Read first
- `AGENTS.md`
- `docs/template_scope.md`
- `docs/platform-truth-index.md`
- `tickets/README.md`
- `tickets/platform/P-009-growth-kit.md`
- `.agent/PLANS.md`
- `docs/shopify-review-promotions.md`
- `docs/app-store-listing-assets.md`
- `.agents/skills/adr-discipline/SKILL.md`
- `.agents/skills/polaris-admin-ui/SKILL.md`
- `.agents/skills/webhook-safety/SKILL.md`
- `.agents/skills/app-review-readiness/SKILL.md`
- 関連 ADR: 0002, 0003, 0004, 0007, 0018, 0019, 0022
- 関連 contracts: webhook compliance, billing routes, admin UI conventions, platform premises doc parity

## Constraints
- `shopify.app.toml`、access scope、billing truth、webhook policy は変更しない。
- Orders / Customers / Discounts scope と Protected Customer Data は追加しない。
- route は `domain/` を直接 import せず、`app/services/` に委譲する。
- FunnelEvent は raw shop domain を保存しない。shop 識別は `TELEMETRY_PSEUDONYM_KEY` による HMAC 偽名化値だけにする。
- FunnelEvent metadata は event ごとの allowlist のみ許可し、顧客 PII を入れない。
- once-only funnel event と onboarding completion は `createMany({ skipDuplicates: true })` / 条件付き `updateMany` で idempotent にし、interactive transaction 内で unique violation を catch して続行しない。
- `TelemetryPseudonymKeyFingerprint` が欠落している場合、既存 `FunnelEvent` が 1 件でもあれば現在キーを正本化せず fail-fast する。復旧は旧キー/fingerprint 復元、または `FunnelEvent.shopHash` の削除/再書き換え migration に限定する。
- `app/uninstalled` は snapshot 記録と raw growth cleanup を分離し、snapshot 失敗や fingerprint mismatch があっても `OnboardingProgress` / `GrowthState` / `ReviewRequestState` cleanup と webhook processed を進める。
- review prompt は価値実感後だけに表示し、オンボーディング中、インセンティブ付き、肯定レビュー要求、checkout/admin UI extensions での表示は扱わない。
- 新規パッケージは追加しない。

## Steps
1. ADR-0026 を追加し、funnel vocabulary、metadata allowlist、retention 90日、uninstall/shop-redact の削除境界、review prompt state machine を固定する。
2. Prisma schema/migration に `FunnelEvent`、`OnboardingProgress`、`GrowthState`、`ReviewRequestState` を追加する。
3. `domain/growth/` に funnel allowlist、onboarding registry、review prompt state machine、Prisma-backed funnel helper を追加する。idempotency は upsert / `createMany({ skipDuplicates: true })` / 条件付き `updateMany` に寄せる。
4. auth bootstrap、billing welcome/pricing/home、app/uninstalled、shop/redact、retention sweep に growth 記録・削除を接続する。`app/uninstalled` は snapshot best-effort と raw growth cleanup を分離する。
5. `app._index` の静的セットアップ List をオンボーディングチェックリストと review prompt UI に置き換え、copy は `app/utils/admin-copy.ts` に集約する。
6. current shop にスコープした週次 funnel summary route を service 経由で追加する。店舗横断集計は embedded app route ではなく DB / 内部 BI 側の責務にする。
7. contract test で vocabulary、metadata allowlist、PII reject、retention、shop/redact、fingerprint-row loss、uninstall snapshot/cleanup 分離、review prompt 全分岐、route/service 境界を固定する。
8. `tickets/README.md` の P-009 status を `done` に更新する。

## ADR impact
- ADR required: yes
- ADR: 0026
- Why: 新規 state machine、route contract、retention/privacy 境界、Prisma schema を追加するため ADR が必要。review prompt と FunnelEvent は merchant privacy と Shopify review 要件に直結するため、実装値を正本化する。

## Validation
- `node --test tests/contracts/growth-kit.contract.test.mjs`
- `node --test tests/contracts/webhook-compliance.contract.test.mjs`
- `node --test tests/contracts/admin-ui-conventions.contract.test.mjs`
- `pnpm check`
- UI 変更: app home は loading / empty 相当の checklist fallback / error / feedback を維持し、Polaris component と `data-testid` 規約に従う。

## Risks / open questions
- review URL は fork 先の App Store URL が確定するまで `SHOPIFY_APP_REVIEW_URL` 未設定のままにし、未設定時は prompt を表示しない。
- テンプレート本体にはドメイン固有の初回価値行動がないため、`activated` は checklist の `activated` step 完了として定義し、派生アプリで completion fn を差し替える。
