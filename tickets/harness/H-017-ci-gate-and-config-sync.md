# H-017 CI gate and config sync

## Objective
`pnpm check` を CI で強制し、Admin API バージョンを単一 truth に同期し、未使用依存を削除する。

## Read first
- `adr/0024-api-version-single-truth-and-ci-gate.md`
- `tests/contracts/shopify-config.contract.test.mjs`
- `.github/workflows/deploy.yml`（既存 workflow の慣例）

## Scope
- `.github/workflows/ci.yml` の新設（push / pull_request で `pnpm check`）
- `shopify.app.toml` の `webhooks.api_version` を `app/shopify.server.ts` の `ApiVersion` と同期（`2026-01`）
- API version 同期の contract test と `ci-workflow` contract test
- `@shopify/app-bridge-react` の削除（package.json / vite.config.ts / lockfile）

## Out of scope
- API バージョン自体の更新（同期のみ）
- deploy workflow の変更
- smoke の CI 実走（`--list` のみ）

## ADR impact
Create `adr/0024-api-version-single-truth-and-ci-gate.md`.

## Acceptance
- push / PR で `pnpm check` が DB・ブラウザ・Shopify 資格情報なしで走る
- `shopify.app.toml` の `api_version` と server の `ApiVersion` の不一致を contract が検出する
- `@shopify/app-bridge-react` が依存から消え、build / typecheck が通る

## Validation
- `node --test tests/contracts/ci-workflow.contract.test.mjs tests/contracts/shopify-config.contract.test.mjs`
- `pnpm install` 後に `pnpm check`
- push 後に GitHub Actions の CI green を確認
