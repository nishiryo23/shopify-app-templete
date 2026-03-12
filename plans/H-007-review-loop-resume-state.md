# H-007 review loop resume state plan

## Goal
`codex:shopify-review-loop` の resume フローで prior review を保持し、失敗時も再開に必要な fix thread id を必ず出力する。

## Read first
- `scripts/run-codex-shopify-review-loop.mjs`
- `scripts/lib/codex-review-loop.mjs`
- `tests/contracts/codex-review-loop.contract.test.mjs`
- `docs/codex-sdk-review-loop.md`
- `adr/0001-repo-truth-and-codex-harness.md`

## Constraints
- review loop の既存 JSON schema は壊さない
- `--thread-id` 再開時は追加の手入力なしで last review を復元できるようにする
- failure / blocked / maxIterations 到達でも fix thread id を失わない

## Steps
1. last review と fix thread id を保存する state file を追加する
2. `--thread-id` 再開時に state file から prior review を復元する
3. すべての終了経路で fix thread id を出力する
4. contract tests と docs を更新して `pnpm check` で検証する

## ADR impact
- 既存 ADR 更新で足りる
- ADR-0001 に review-loop resume state の truth を追記する

## Validation
- `pnpm run test:contracts`
- `pnpm check`

## Risks / open questions
- state file が無い状態で `--thread-id` 再開した場合は prior review を復元できない。その場合は resume 自体は継続しつつ warning を出す
