# H-006 smoke auth and webhook subscription dedupe plan

## Goal
Shopify admin reviewer URL を使う smoke 実行で認証 state 不足による false failure を防ぎ、webhook inbox dedupe を subscription 単位の正規配送と retry 重複の両方に対応させる。

## Read first
- `docs/dev-store-smoke-checklist.md`
- `playwright.config.mjs`
- `scripts/validate-smoke-env.mjs`
- `tests/contracts/smoke-env.contract.test.mjs`
- `domain/webhooks/inbox-contract.mjs`
- `tests/contracts/webhook-ingress.contract.test.mjs`
- `adr/0004-app-specific-https-webhooks-only.md`

## Constraints
- `pnpm check` の smoke scaffold は維持する
- reviewer/admin URL を使う embedded smoke は認証済み state なしで成功扱いにしない
- webhook duplicate no-op は同一 subscription 内 retry に限定し、別 subscription の正規配送は落とさない

## Steps
1. admin reviewer URL 判定と `SMOKE_STORAGE_STATE_PATH` 前提を validate/config/docs に追加する
2. Playwright config に認証済み storage state を注入できるようにする
3. webhook dedupe key を subscription 識別子込みへ戻し、関連 contract/ADR を同期する
4. `pnpm run test:contracts` と `pnpm check` で検証する

## ADR impact
- ADR required: yes
- ADR: 0001, 0004
- Why: smoke auth requirement と webhook dedupe truth の両方を更新するため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`

## Risks / open questions
- Shopify 公式 docs は `X-Shopify-Event-Id` を duplicate detection に使うことを推奨しつつ、`X-Shopify-Name` で複数 subscription を識別できるとしている。subscription 別配送を保持する dedupe は、この 2 つを組み合わせた repo-level interpretation になる
