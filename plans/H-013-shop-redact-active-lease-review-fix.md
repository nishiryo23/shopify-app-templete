# H-013 shop redact active lease review fix plan

## Goal
`shop/redact` 実行中に現在の compliance job と lease を消してしまい、worker finalization が失敗する問題を修正する。

## Read first
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0004-app-specific-https-webhooks-only.md`
- `adr/0018-webhook-inbox-raw-payload-retention-boundary.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/references/loop-procedure.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/references/reviewer-checklist.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/references/verification-gate-policy.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-fix/references/fix-checklist.md`
- `tests/contracts/webhook-compliance.contract.test.mjs`
- `tests/contracts/webhook-compliance-queue.contract.test.mjs`

## Constraints
- `shop/redact` は durable enqueue 後に background job で実行する truth を変えない
- compliance webhook の TOML truth や route contract は変えない
- shop data purge と queue finalization の両立を壊さない

## Steps
1. active compliance job / lease を purge 対象から外す条件を定義する
2. worker から purge 実装へ preserve 情報を渡す
3. contract test で current job / lease preserve を直接検証する
4. `pnpm check` を実行して gate を確認する

## ADR impact
- ADR required: no
- ADR: 0004,0018
- Why: 既存 ADR の durable compliance processing と retention boundary に整合させる修正で、新しい設計判断は追加しない

## Validation
- contract
- `pnpm check`
- Shopify compliance webhook docs との整合確認

## Risks / open questions
- 同一 shop の残存 queued/retryable job を redaction 時に削除する前提は維持する
- full readiness 判定は root cause 修正後も別 diff の影響を受ける
