# H-014 compliance webhook config deploy review fix plan

## Goal
`shopify.app.toml` に追加した compliance webhook subscription を、既存の infra-only deploy 運用を壊さずに Shopify CLI deploy 経路から反映できるようにする。

## Read first
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0004-app-specific-https-webhooks-only.md`
- `adr/0019-app-review-metadata-and-reviewer-packet-truth.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/references/loop-procedure.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/references/reviewer-checklist.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/references/verification-gate-policy.md`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-fix/references/fix-checklist.md`
- `.github/workflows/deploy.yml`
- `tests/contracts/aws-infra-bootstrap.contract.test.mjs`

## Constraints
- compliance webhook の TOML truth は変えない
- webhook runtime contract や route は変えない
- Shopify app config の deploy は CI/CD 向けの公式 CLI フラグに合わせる

## Steps
1. deploy workflow の Shopify config deploy は opt-in のまま維持しつつ、明示実行時の CLI 挙動を見直す
2. CI の `shopify app deploy` に non-interactive update 用フラグを追加する
3. contract test で workflow truth を固定する
4. `pnpm check` を実行して gate を確認する

## ADR impact
- ADR required: no
- ADR: 0004,0019
- Why: 既存の webhook truth と review readiness truth に沿って deploy parity を補強する修正で、新しい設計判断は追加しない

## Validation
- contract
- `pnpm check`
- Shopify CLI `app deploy` docs との整合確認

## Risks / open questions
- compliance webhook を Shopify 側へ反映するには `run_shopify_deploy=true` の明示実行が必要
- `shop/redact` の外部削除順の root cause は別周回で扱う
