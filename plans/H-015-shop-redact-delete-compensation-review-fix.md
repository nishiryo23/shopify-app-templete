# H-015 shop redact delete compensation review fix plan

## Goal
`shop/redact` 実行中に外部 artifact 削除が先行しても、DB failure や lease loss で S3 と DB が不整合にならないようにする。

## Read first
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0004-app-specific-https-webhooks-only.md`
- `adr/0018-webhook-inbox-raw-payload-retention-boundary.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/references/loop-procedure.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/references/reviewer-checklist.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/references/verification-gate-policy.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-fix/references/fix-checklist.md`
- `domain/webhooks/compliance.server.mjs`
- `tests/contracts/webhook-compliance.contract.test.mjs`
- `tests/contracts/webhook-compliance-queue.contract.test.mjs`

## Constraints
- `shop/redact` は durable enqueue 後に background job で実行する truth を変えない
- compliance webhook の route/TOML/runtime contract は変えない
- purge failure 時は DB と external artifact の整合性を優先し、補償なしの先行 delete を残さない

## Steps
1. `eraseShopData` で restore 可能な artifact backup 情報を集める
2. 外部 delete 先行時に transaction / lease 失敗なら restore する補償を入れる
3. DB failure と partial delete failure を直接叩く contract test を追加する
4. `pnpm check` を実行して gate を確認する

## ADR impact
- ADR required: no
- ADR: 0004,0018
- Why: 既存の durable compliance processing と retention boundary の範囲で failure compensation を追加するだけで、新しい source-of-truth は増やさない

## Validation
- contract
- `pnpm check`
- Shopify compliance webhook docs との整合確認

## Risks / open questions
- 外部 storage の restore 自体が失敗した場合は retry 余地を残しつつエラーを返す
- app review readiness 全体は別 root cause の有無に依存する
