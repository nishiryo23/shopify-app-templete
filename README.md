# Shopify App Harness Template

Codex / エージェント向けの **チケット制・ADR・契約テスト・ガードレール** を含む Shopify 埋め込みアプリのテンプレートです。ドメイン機能は含めず、認証・課金シェル・標準 webhook・バックグラウンド worker（コンプライアンス redact / システムスイープ）までを最小構成とします。

## Main files

- [AGENTS.md](AGENTS.md)
- [docs/template_scope.md](docs/template_scope.md)
- [docs/codex_harness_bootstrap.md](docs/codex_harness_bootstrap.md)
- [CODEX_START_PROMPT.md](CODEX_START_PROMPT.md)
- [.agent/PLANS.md](.agent/PLANS.md)
- `.agents/skills/*`
- `codex/rules/default.rules`
- [tickets/README.md](tickets/README.md)

## Start

1. [CODEX_START_PROMPT.md](CODEX_START_PROMPT.md)
2. [AGENTS.md](AGENTS.md)
3. [docs/template_scope.md](docs/template_scope.md)
4. [tickets/README.md](tickets/README.md)

## Fork 時

1. Partner Dashboard でアプリを作成し、`shopify app config link` で [shopify.app.toml](shopify.app.toml) を自分のアプリに紐づける（`client_id` / `name` を置換）。
2. `.env` を [.env.example](.env.example) からコピーし、`DATABASE_URL` と暗号化キーを設定。
3. `pnpm install && pnpm run setup && pnpm check`

## Runtime notes

- `SHOP_TOKEN_ENCRYPTION_KEY`: offline token 暗号化用の base64（32 byte）。未設定時は開発環境で legacy fallback する場合がある。
- `PROVENANCE_SIGNING_KEY`: 任意。`domain/provenance` を使う機能を追加するときに設定（`.env.example` 参照）。

## ローカル開発（トンネル URL）

`shopify app dev` とトンネル URL の扱いは **[docs/shopify_local_development.md](docs/shopify_local_development.md)** を参照。

`shopify app dev` は [shopify.web.toml](shopify.web.toml) 経由で web と worker を同時起動する。キューに載るジョブを処理するため **worker も必要**です。worker だけ再起動する場合は `pnpm run dev:worker`。
