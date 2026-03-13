# H-010 worker non-production runtime contract review fix plan

## Goal
worker の非本番 runtime contract を起動時 validation と実行時挙動で一致させ、許可された fallback は維持し、成功不能な設定は起動前に fail-fast する。

## Root cause
- worker storage は `SHOP_TOKEN_ENCRYPTION_KEY` 未設定時の fallback 契約を `findSessionsByShop` にしか反映しておらず、offline `storeSession` では暗号鍵必須のままになっている
- worker env validation は `PROVENANCE_SIGNING_KEY` 未設定の非本番起動を許しており、実行不能な `product.export` job を lease できてしまう

## Scope
- `workers/offline-admin.mjs`
- `workers/bootstrap.mjs`
- `tests/contracts/product-export.contract.test.mjs`
- `tests/contracts/aws-infra-bootstrap.contract.test.mjs`

## Constraints
- `SHOP_TOKEN_ENCRYPTION_KEY` 未設定時の後方互換 fallback は app 側 storage と揃える
- `PROVENANCE_SIGNING_KEY` は全環境で fail-fast にする
- root cause を直接叩く test を追加する

## Steps
1. worker storage の offline `storeSession` に暗号鍵未設定 fallback を戻す
2. worker env validation を always-required secret と production-only secret に分ける
3. contract test を更新して非本番 fallback と fail-fast を固定する
4. `pnpm check` で標準 gate を通す

## ADR impact
- ADR required: no
- ADR: none
- Why: 既存 rollout / secret truth を変更せず、worker 実装の parity を回復する修正のため

## Validation
- `pnpm run test:contracts`
- `pnpm check`
