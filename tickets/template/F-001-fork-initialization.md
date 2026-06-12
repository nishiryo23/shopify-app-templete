# F-001 Fork initialization

> **fork 時に実行する ticket。** テンプレ本体では実行済みにしない。実行時は `plans/F-001-fork-initialization.md` を作ってから進める。

## Objective
fork したリポジトリを自分のアプリとして動かすための初期化（識別子・URL・metadata の置換）を、truth を壊さずに行う。

## Read first
- `README.md`（Fork 時）
- `docs/template_scope.md` / `docs/platform-truth-index.md`
- `adr/0023-empty-minimal-access-scopes-baseline.md`（scope 追加の手順）
- `docs/app-review-metadata.md`

## Checklist

### 1. アプリ識別子と URL
- [ ] Partner Dashboard でアプリを作成し、`shopify app config link` で `shopify.app.toml` を紐づける（`client_id` / `name` が置換される）
- [ ] `application_url` と `[auth].redirect_urls` を本番 URL に置換する（`https://example.com` を残さない）
- [ ] `SHOPIFY_APP_HANDLE` を設定する（Partner Dashboard のアプリ handle）。設定先: `.env` / GitHub Actions `vars.SHOPIFY_APP_HANDLE` / web task definition。未設定の間は pricing 画面の plan selection CTA が表示されない（ADR-0003）

### 2. Secrets / 環境変数
- [ ] `.env` を `.env.example` から作成し、`DATABASE_URL` と `SHOP_TOKEN_ENCRYPTION_KEY`（`openssl rand -base64 32`）を設定する
- [ ] 本番用 secrets（`SHOPIFY_API_SECRET` / `TELEMETRY_PSEUDONYM_KEY` 等）を Secrets Manager に作成し、deploy workflow の input に ARN を渡す（`infra/aws/README.md`）

### 3. Scopes（必要時のみ）
- [ ] baseline は空（ADR-0023）。scope が必要なドメイン機能を作るときは、**ticket + ADR** で `shopify.app.toml` / `.env` の `SCOPES` / GitHub `vars.SCOPES` を同時更新する
- [ ] scope を変更したら dev store で再 install して granted scopes を確認する（truth は `currentAppInstallation.accessScopes`、ADR-0002）

### 4. Review metadata / 提出物
- [ ] `docs/app-review-metadata.md` の support email / submission contact / privacy policy URL を自分のものに置換する
- [ ] `docs/reviewer-packet.md` の URL / 手順を自アプリに合わせて更新する

### 5. 動作確認
- [ ] `pnpm install && pnpm run setup && pnpm check`
- [ ] `shopify app dev` で install → `/app` ホーム → `/app/pricing` の plan selection CTA → webhook 登録を確認する（`docs/dev-store-smoke-checklist.md`）

## Out of scope
- ドメイン機能の追加（`.agents/skills/domain-feature-stub/SKILL.md` を複製して別 ticket で行う）
- billing truth / webhook policy / privacy contract の変更

## ADR impact
原則 none（識別子・URL の置換のみ）。scope を追加する場合はその ticket 側で ADR を作る（ADR-0023 の運用）。

## Acceptance
- プレースホルダ（`client_id = "000..."` / `https://example.com`）が残っていない
- `pnpm check` と dev store smoke が通る

## Validation
- `pnpm check`
- `docs/dev-store-smoke-checklist.md` の Manual checklist
