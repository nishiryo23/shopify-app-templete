# Shopify App Harness Template

Codex / エージェント向けの **チケット制・ADR・契約テスト・ガードレール** を含む Shopify 埋め込みアプリのテンプレートです。ドメイン機能は含めず、認証・課金シェル・標準 webhook・バックグラウンド worker（コンプライアンス redact / システムスイープ）までを最小構成とします。

## Main files

- [AGENTS.md](AGENTS.md)
- [docs/platform-truth-index.md](docs/platform-truth-index.md)（docs 探索の入口・プラットフォーム統合索引）
- [docs/template_scope.md](docs/template_scope.md)
- [CODEX_START_PROMPT.md](CODEX_START_PROMPT.md)
- [.agent/PLANS.md](.agent/PLANS.md)
- `.agents/skills/*`
- `codex/rules/default.rules`
- [tickets/README.md](tickets/README.md)

## Start

1. [CODEX_START_PROMPT.md](CODEX_START_PROMPT.md)
2. [AGENTS.md](AGENTS.md)
3. [docs/template_scope.md](docs/template_scope.md)
4. [docs/platform-truth-index.md](docs/platform-truth-index.md)（docs 探索の入口）
5. [tickets/README.md](tickets/README.md)

## Fork 時

[tickets/template/F-001-fork-initialization.md](tickets/template/F-001-fork-initialization.md) のチェックリストに従う。要約:

1. Partner Dashboard でアプリを作成し、`shopify app config link` で [shopify.app.toml](shopify.app.toml) を自分のアプリに紐づける（`client_id` / `name` を置換）。
2. `node scripts/init-new-app.mjs --confirm-fork` を実行し、URL / review metadata / `.env` を同期する。既存 `SHOP_TOKEN_ENCRYPTION_KEY` は保持され、rotation は `--rotate-shop-token-key` 明示時のみ行う。
3. `pnpm install && pnpm run setup && pnpm check`

## 検証ゲート

- **日常（CI / ローカル）:** `pnpm check` — lint, contracts, ADR discipline, typecheck, build, smoke 一覧確認。
- **提出前:** `pnpm run verify:pre-release` — 上記 + Playwright smoke 実走。URL / 認証情報が必要。

提出時は [docs/release-gate-matrix.md](docs/release-gate-matrix.md) を確認し、[docs/reviewer-packet.md](docs/reviewer-packet.md) の evidence を更新すること。プラットフォーム統合の正本索引は [docs/platform-truth-index.md](docs/platform-truth-index.md)、テンプレ境界は [docs/template_scope.md](docs/template_scope.md) を参照。

## Runtime notes

- `SHOP_TOKEN_ENCRYPTION_KEY`: offline token 暗号化用の base64（32 byte）。未設定時は開発環境で legacy fallback する場合がある。
- `SHOPIFY_APP_GID`: 必須。Partner API `activeSubscription(appId, shopId)` の `appId`。`gid://shopify/App/...` 形式。
- `PARTNER_API_ORG_ID`: 必須。Partner API endpoint の organization id。endpoint は `https://partners.shopify.com/{organization_id}/api/2026-07/graphql.json`。
- `PARTNER_API_ACCESS_TOKEN`: 必須。Shopify App Pricing entitlement refresh 用の Partner API token。Billing snapshot が未作成または TTL（約 10 分）切れのときに未設定なら refresh は fail-fast する。既存 snapshot がある場合は Partner API 失敗時も直近 snapshot に fallback する。
- `BILLING_TEST_PLAN_HANDLES`: 任意。公開有料 plan handle は `standard` 固定で、$0 private test plan などを有料扱いにする場合だけカンマ区切りで追加する（例: `pro_plan`。英小文字・数字・hyphen・underscore を許容）。
- `PROVENANCE_SIGNING_KEY`: 任意。`domain/provenance` を使う機能を追加するときに設定（`.env.example` 参照）。

既存インストールで `Shop.shopGid` が未保存の場合、次回の認証済み Admin bootstrap で `shop { id }` を取得して snapshot に保存する。billing resolver は保存済み `gid://shopify/Shop/...` を Partner API `shopId` に使い、参照ごとに Admin API を叩かない。

## ローカル開発（トンネル URL）

`shopify app dev` とトンネル URL の扱いは **[docs/shopify_local_development.md](docs/shopify_local_development.md)** を参照。

`shopify app dev` は [shopify.web.toml](shopify.web.toml) 経由で web と worker を同時起動する。キューに載るジョブを処理するため **worker も必要**です。worker だけ再起動する場合は `pnpm run dev:worker`。
