# P-008 Minimal empty access scopes

## Objective
テンプレ baseline の access scopes を空にし、`SCOPES` env を optional 化して least-privilege な既定値にする。

## Read first
- `docs/platform-truth-index.md`
- `adr/0023-empty-minimal-access-scopes-baseline.md`
- `adr/0002-embedded-auth-and-token-exchange.md`（scope truth）

## Scope
- `shopify.app.toml` の `scopes = ""`
- `app/shopify.server.ts` / `workers/offline-admin.mjs` の空 SCOPES ガード（`[""]` バグ修正）
- `workers/bootstrap.mjs` の必須 env から `SCOPES` を除外
- deploy workflow / `.env.example` / `infra/aws/README.md` の SCOPES optional 化
- contract test の更新

## Out of scope
- granted scope truth（`currentAppInstallation.accessScopes`）の変更
- webhook / billing / privacy contract の変更
- scope を使うドメイン機能の追加

## ADR impact
Create `adr/0023-empty-minimal-access-scopes-baseline.md`.

## Acceptance
- `shopify.app.toml` の scopes が空で、`pnpm check` が通る
- `SCOPES` 未設定でも web / worker が起動検証を通過する（contract で検証）
- `SCOPES=""` が `[""]` として shopifyApp に渡らない
- 空 scope baseline で保存される `grantedScopes: []` は bootstrap 済みの有効状態として扱い、`lastBootstrapAt` を freshness sentinel にする
- deploy workflow の必須検証が `SHOPIFY_API_KEY` / `SHOPIFY_APP_URL` のみになる

## Validation
- `node --test tests/contracts/shopify-config.contract.test.mjs tests/contracts/aws-infra-bootstrap.contract.test.mjs`
- `pnpm check`
- dev store で `shopify app dev` を起動し、空 scope での install / token exchange / webhook 登録を確認
