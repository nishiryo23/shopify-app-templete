# H-009 worker lease finalization review fix plan

## Goal
`product.export` worker が artifact 書き込み完了後の final state transition まで lease heartbeat を維持し、stale lease による duplicate rerun を防ぐ。

## Root cause
- `runJobWithLeaseHeartbeat` が `runJob()` 完了時点で heartbeat を止めている
- `jobQueue.complete()` はその後に別フェーズで呼ばれるため、finalize 中に lease が失効すると成功済み export が再 lease 可能になる

## Scope
- `workers/bootstrap.mjs`
- `tests/contracts/aws-infra-bootstrap.contract.test.mjs`

## Constraints
- root cause は lease/finalization のみ
- job success path で fail path へ downgrade しない
- root cause を直接叩く test を追加する

## Steps
1. heartbeat 維持下で finalize callback を実行できるようにする
2. `runBootstrapWorker` の complete path を heartbeat 管理下へ寄せる
3. finalize 中の heartbeat 継続を確認する契約テストを追加する
4. `pnpm check` で標準 gate を通す

## ADR impact
- ADR required: no
- ADR: none
- Why: 既存 queue/lease truth の運用不備修正で、source-of-truth 自体は変えないため

## Validation
- `pnpm run test:contracts`
- `pnpm check`
