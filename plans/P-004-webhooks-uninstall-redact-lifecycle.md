# P-004-webhooks-uninstall-redact-lifecycle plan

## Goal
Shopify webhook inbox の重複排除を `X-Shopify-Event-Id` 基準へ修正し、同一 event の二重 enqueue を防ぐ。

## Read first
- `tickets/platform/P-004-webhooks-uninstall-redact-lifecycle.md`
- `adr/0004-app-specific-https-webhooks-only.md`
- `.agents/skills/webhook-safety/SKILL.md`
- `docs/shopify_app_technical_spec_complete.md`
- `domain/webhooks/inbox-contract.mjs`
- `tests/contracts/webhook-ingress.contract.test.mjs`

## Constraints
- webhook ingress の HMAC 検証と 401/200 contract は変えない
- dedupe の truth は Shopify の `X-Shopify-Event-Id` semantics に従う
- launch scope 外の business logic や subscription 拡張は触らない

## Steps
1. Shopify 公式 duplicate webhook guidance と repo 仕様を確認し、期待挙動を固定する
2. inbox contract の delivery key を event ID 基準へ修正する
3. contract test と ADR を同期させ、重複配信ケースを検証する
4. `pnpm run test:contracts` と `pnpm check` で検証する

## ADR impact
- 既存 ADR 更新で足りる
- ADR-0004 に webhook inbox dedupe truth を追記する

## Validation
- `pnpm run test:contracts`
- `pnpm check`

## Risks / open questions
- 現状 contract は `shopDomain + topic + eventId` を dedupe scope に含める。Shopify docs は event ID reuse を duplicate 判定の基準にしているが、cross-shop collision は実運用上避けるため scope は shop/topic を維持する
