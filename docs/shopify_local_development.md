# ローカル開発: Shopify CLI とトンネル URL

## 目的

`shopify app dev` はセッションごとに **Cloudflare 等のトンネル URL** を発行し、環境変数（多くの場合 `HOST` や `SHOPIFY_APP_URL`）に渡す。リポジトリの `shopify.app.toml` では `application_url` / `redirect_urls` がプレースホルダ（`https://example.com`）のままであることがあり、**OAuth やアプリのベース URL は実行時に CLI が渡すトンネルを使う**必要がある。

## このリポジトリでの自動反映

`scripts/shopify-dev-app-url.mjs` を次のタイミングで実行し、有効な HTTPS のアプリベース URL を `process.env.SHOPIFY_APP_URL` に正規化する。

- `vite.config.ts` の読み込み直後（Vite の `allowedHosts` / HMR 用ホストと整合させる）
- `app/shopify.server.ts` の `shopifyApp()` 呼び出し直前（サーバー側の `appUrl` と整合させる）

解決順（いずれも **非プレースホルダ** のものだけ採用）:

1. `HOST`（Shopify CLI が付与）
2. `APP_URL`（同上。公式ドキュメントでは `HOST` / `APP_URL` のどちらかにトンネルが入る）
3. `SHOPIFY_FLAG_TUNNEL_URL`（`shopify app dev --tunnel-url` 利用時など）
4. `SHOPIFY_APP_URL`

トンネルが **どの変数にも無い** のに `.env` だけ `SHOPIFY_APP_URL=https://example.com` がある場合、そのプレースホルダは **削除**する（OAuth が example.com に飛ぶのを防ぐ。代わりに `appUrl` 未設定で起動失敗し、`shopify app dev` 必須に気づける）。

`https://example.com` / `www.example.com` は **ドキュメント用プレースホルダとして無視**する。`.env` に誤って `SHOPIFY_APP_URL=https://example.com` があっても、**CLI のトンネルが優先**される。

## 運用上の注意

- **`pnpm dev`（`shopify app dev`）で起動する**。このリポジトリでは `shopify.web.toml` の `dev` が `scripts/dev-with-worker.mjs` を呼び、`web` と `worker` を同時に起動する。`react-router dev` だけでは CLI のトンネルと URL 同期が効かず、export / preview / write の job が `queued` のまま残る。
- `shopify.app.toml` の **`[build] automatically_update_urls_on_dev = true`** のとき、CLI が Partner 側のアプリ URL / リダイレクト URL を開発用トンネルに合わせて更新する。固定したい場合は `--no-update`（[app dev](https://shopify.dev/docs/api/shopify-cli/app/app-dev)）を参照。
- `.env` に **`SHOPIFY_APP_URL` を固定で書かない**（トンネルホストはセッションごとに変わる）。`DATABASE_URL` や `SHOPIFY_API_KEY` などは `.env` でよい。
- worker 単体を再起動したい場合は **`pnpm run dev:worker`** を使う。このスクリプトはローカル用に `AWS_REGION=ap-northeast-1`、`QUEUE_POLL_INTERVAL_MS=1000`、`QUEUE_LEASE_MS=30000`、`S3_ARTIFACT_BUCKET=local-artifacts`、`S3_ARTIFACT_PREFIX=dev` を補い、`HOST` / `APP_URL` / `SHOPIFY_APP_URL` のいずれかからトンネル URL を解決する。

## まだブラウザが「Example Domain」（example.com）になる場合

次の **2 系統** がある。

1. **このアプリの `appUrl` が example.com のまま**  
   上記の `HOST` / `APP_URL` を読めていない、または `.env` の `SHOPIFY_APP_URL=https://example.com` が残っている。  
   → `pnpm dev`（`shopify app dev`）で起動し直す。`.env` に `SHOPIFY_APP_URL` を書いている場合は削除するかコメントアウトする。worker だけ起動したい場合は、`Using URL:` に出たトンネル URL を `SHOPIFY_APP_URL=... pnpm run dev:worker` で渡す。

2. **Shopify Partners 上のアプリ設定の URL がまだ example.com**（OAuth 完了後にブラウザだけ example.com に飛ぶ）  
   これは **Shopify 側に登録された application URL / redirect URLs** がプレースホルダのままのとき起きる。Node の環境変数だけでは直せない。  
   → `[build] automatically_update_urls_on_dev = true` のまま **`shopify app dev` を一度止めて `--reset` で再実行**する。  
   → [Partners](https://partners.shopify.com) → 該当アプリ → **設定**で、App URL と Allowed redirection URL(s) がターミナルの **Using URL:**（`*.trycloudflare.com` 等）と一致しているか確認し、必要なら手で合わせる（`/auth/callback` まで含む）。

## 参照

- [Shopify CLI: app dev](https://shopify.dev/docs/api/shopify-cli/app/app-dev)
- [App structure / shopify.web.toml（`HOST` / `APP_URL`）](https://shopify.dev/docs/apps/build/cli-for-apps/app-structure#shopify-web-toml)
- App configuration の `automatically_update_urls_on_dev`（[App configuration](https://shopify.dev/docs/apps/tools/cli/configuration)）
