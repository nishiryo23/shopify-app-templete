# O-002 app review readiness and release gate plan

## Goal
App Store review readiness の truth を repo に置き、review metadata / reviewer packet / release gate を再現可能にする。

## Read first
- `tickets/operability/O-002-app-review-readiness-and-release-gate.md`
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/app-review-readiness/SKILL.md`
- `docs/dev-store-smoke-checklist.md`
- `tests/contracts/shopify-config.contract.test.mjs`

## Constraints
- `shopify.app.toml` の webhook / scope / embedded truth は変えない。
- Shopify review readiness の妥当性は Shopify 公式 docs を正本にする。
- support email / submission contact email / privacy policy URL は不明な値を捏造しない。

## Steps
1. review metadata / reviewer packet / release gate の repo truth を docs に追加する。
2. review metadata truth の昇格理由を ADR に残す。
3. docs の必須 section と gate を contract test で固定し、`pnpm check` まで通す。

## ADR impact
- ADR required: yes
- ADR: 0019
- Why: review metadata と reviewer packet の source-of-truth を repo 管理へ昇格させ、submission gate の運用 truth を追加するため。

## Validation
- contract tests for readiness docs
- `pnpm check`
- reviewer packet と smoke checklist の整合確認

## Risks / open questions
- 実際の support email / submission contact email / privacy policy URL は repo からは発見できず、submission 前に実値投入が必要。
