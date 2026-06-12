# H-017 CI gate and config sync plan

## Goal
検証ゲートの CI 強制・API version の単一 truth 化・未使用依存の削除を行う。

## Read first
- `tickets/harness/H-017-ci-gate-and-config-sync.md`
- `adr/0024-api-version-single-truth-and-ci-gate.md`
- `package.json`（check スクリプトの構成）

## Constraints
- `pnpm check` の中身は変えない（CI から呼ぶだけ）
- webhook subscription の topics / uri は変えない（api_version のみ）
- App Bridge の提供経路（AppProvider の script 注入）を変えない

## Steps
1. ADR-0024 を作成する
2. `.github/workflows/ci.yml` を新設する（Node 22 / corepack / frozen lockfile / `pnpm run check`）
3. `shopify.app.toml` の `webhooks.api_version` を `2026-01` に揃える
4. shopify-config contract に server `ApiVersion` ↔ toml `api_version` の同期検証を追加する
5. `ci-workflow` contract test を新設する
6. `@shopify/app-bridge-react` を package.json / vite.config.ts から削除し、`pnpm install` で lockfile を更新する
7. `pnpm check` を実行する

## ADR impact
- ADR required: yes
- ADR: 0024
- Why: `shopify.app.toml` の webhook api_version 変更を含み、API version truth と CI gate の設計判断を新設するため。

## Validation
- `node --test tests/contracts/ci-workflow.contract.test.mjs tests/contracts/shopify-config.contract.test.mjs`
- `pnpm install` → `pnpm check`
- push 後の GitHub Actions green 確認

## Risks / open questions
- `ApiVersion` enum 名→文字列の静的 map は、ライブラリのバージョン更新時に手動更新が必要（意図的な摩擦として ADR に記録済み）
