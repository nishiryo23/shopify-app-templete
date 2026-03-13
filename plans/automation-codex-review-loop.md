# automation-codex-review-loop plan

## Goal
`$shopify-review-loop` 実行後に uncommitted diff を review し、指摘があれば同一 thread で再度 loop を回して、指摘がなくなれば終了する Node.js スクリプトを追加する。

## Read first
- `AGENTS.md`
- `package.json`
- `/Users/nishimuraryousuke/.codex/skills/shopify-review-loop/SKILL.md`
- OpenAI Codex SDK / review docs

## Constraints
- Shopify app の truth や ADR は変更しない
- `/review` slash command そのものではなく、SDK から再現できる review task として実装する
- 既存の dirty worktree を壊さない
- 実装後は repo にある validation を実行する

## Steps
1. Codex SDK の API と認証前提を確認する
2. review loop スクリプトと必要な npm script を追加する
3. 使い方ドキュメントと contract test を追加する
4. `pnpm check` を実行して通す

## ADR impact
- ADR required: no
- ADR: none
- Why: review automation script の追加であり、Shopify app の設計判断は変更しないため。

## Validation
- `pnpm run lint`
- `pnpm run test:contracts`
- `pnpm check`

## Risks / open questions
- Codex SDK から slash command `/review` を直接呼べない場合は、同等の review task prompt に置き換える
- 実行には OpenAI 側の認証設定が必要
