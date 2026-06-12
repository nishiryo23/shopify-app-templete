# P-008 minimal empty access scopes plan

## Goal
旧 product-domain 由来の 7 scope を撤去し、テンプレ baseline を空 scope にする。

## Read first
- `tickets/platform/P-008-minimal-empty-access-scopes.md`
- `adr/0023-empty-minimal-access-scopes-baseline.md`
- `workers/bootstrap.mjs`（REQUIRED_WORKER_CONFIG）
- `tests/contracts/aws-infra-bootstrap.contract.test.mjs`（workflow 検証 assert と validateWorkerEnvironment テスト）

## Constraints
- granted scope truth（ADR-0002）と webhook / billing contract を変えない
- aws-infra contract の fixture が渡す `SCOPES` 値は有効な入力のため変更しない
- deploy workflow は `SCOPES` を空のまま task definition に渡し続ける（render script は空値許容）

## Steps
1. `shopify.app.toml` を `scopes = ""` にする
2. `app/shopify.server.ts` / `workers/offline-admin.mjs` に trim + filter(Boolean) ガードを入れる
3. `workers/bootstrap.mjs` の REQUIRED_WORKER_CONFIG から `SCOPES` を外す
4. deploy workflow の必須検証ループから `SCOPES` を外し、`.env.example` / infra README を optional 表記にする
5. contract test を更新する（workflow 検証 assert、SCOPES なし成功テスト、toml / ガードの assert）
6. `pnpm check` を実行する

## ADR impact
- ADR required: yes
- ADR: 0023
- Why: `shopify.app.toml` の scope truth を空 baseline に変更し、SCOPES env を optional 化する設計判断のため。

## Validation
- `node --test tests/contracts/shopify-config.contract.test.mjs tests/contracts/aws-infra-bootstrap.contract.test.mjs`
- `pnpm check`
- dev store での空 scope install 確認（手動）

## Risks / open questions
- Shopify CLI が `scopes = ""` を拒否した場合は `[access_scopes]` ブロック削除にフォールバックする（ADR-0023 Alternatives に記載）
- fork 済み環境では scope ダウングレードに伴い再 install が必要になる場合がある（F-001 に注意書きを置く）
