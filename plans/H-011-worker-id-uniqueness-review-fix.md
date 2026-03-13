# H-011 worker id uniqueness review fix plan

## Goal
並列 worker 環境でも stale-worker fence が効くように、worker identity をプロセス境界ごとに一意にする。

## Root cause
- worker ID が `pid` のみで生成されている
- ECS/Fargate のように複数コンテナの Node が `pid=1` で起動すると `leasedBy` が衝突し、stale worker が再リース後の job を finalize できてしまう

## Scope
- `workers/bootstrap.mjs`
- `tests/contracts/aws-infra-bootstrap.contract.test.mjs`

## Constraints
- 1 root cause に閉じる
- `leasedBy` 比較の前提を壊さない
- root cause を直接叩く test を追加する

## Steps
1. worker ID を per-process unique token を含む形へ変更する
2. PID だけに依存しないことを契約テストで固定する
3. `pnpm check` で標準 gate を通す

## ADR impact
- ADR required: no
- ADR: none
- Why: worker lease truth 自体は維持し、identity 生成実装だけを修正するため

## Validation
- `pnpm run test:contracts`
- `pnpm check`
