# F-002 Fork 初期化のスクリプト化

> テンプレ本体で fork 導線を整備する ticket。実行時は `plans/F-002-fork-init-script.md` を作ってから進める。

## Objective

F-001 の手作業チェックリスト（約 10 ステップ）を `scripts/init-new-app.mjs` の対話式 1 コマンドに圧縮し、
3 箇所同期（`SHOPIFY_APP_HANDLE`）等のドリフト事故をなくす。

## Read first

- `tickets/template/F-001-fork-initialization.md`（本スクリプトの仕様書として扱う）
- `docs/app-review-metadata.md` / `docs/reviewer-packet.md`（プレースホルダ差し込み対象）
- 参考実装: `~/project/shopify-factory/scripts/sync-shopify-app-config.ts`、`~/project/shopify_receipt_package/scripts/write-shopify-app-config.mjs`

## Checklist

- [ ] preflight: production `shopify.app.toml` は `shopify app config link` 済みにする。
      Shopify CLI の config link は config file を作成または上書きするため、script 実行後に link すると
      script が書いた `application_url` / `redirect_urls` が失われ得る。
- [ ] preflight: fork 初期化であることを `--confirm-fork` で明示し、canonical テンプレ checkout または
      未リンクテンプレートでは書き込み前に fail-fast する。
- [ ] 入力: アプリ名 / handle / 本番 URL（origin-only の HTTPS URL。`client_id` は `shopify app config link` に委譲）/
      review metadata（privacy policy URL は userinfo を拒否）
- [ ] 自動化: `.env` 生成（`SHOP_TOKEN_ENCRYPTION_KEY` は未設定時のみ `node:crypto` で生成。既存 key は保持し、
      rotation は `--rotate-shop-token-key` 明示時のみ許可）/ `application_url`・`redirect_urls` 置換 /
      `SHOPIFY_APP_HANDLE` の 3 箇所同期（`.env` 書込み、GitHub vars と task definition は手順を画面表示）/
      `docs/app-review-metadata.md`・`docs/reviewer-packet.md` のプレースホルダ差し込み
- [ ] `shopify.app.development.toml` の雛形生成（開発用アプリの config 分離のみ。webhook / scope の内容は本番
      `shopify.app.toml` と同一に保ち、内容の変更は各ドメイン ticket + ADR に委ねる）
- [ ] 最後に `pnpm install && pnpm run setup && pnpm check` を実行し、残プレースホルダを検査して fail-fast
- [ ] contract test: プレースホルダ残存検査、production config link の preflight、canonical checkout no-write、
      既存 `SHOP_TOKEN_ENCRYPTION_KEY` 保持、明示 rotation をテスト化し、F-001 の Acceptance を機械化

## Out of scope

- scope 追加の自動化（ADR-0023 の ticket + ADR 運用を維持する）
- ドメイン webhook（orders 等）や Protected Customer Data 前提の config 生成（必要になった派生アプリ側で
  ドメイン ticket + ADR として行う。テンプレの最小スコープ方針は変更しない）
- Partner Dashboard 側の操作自動化

## ADR impact

fork 初期化手順の正本が F-001（手動）→ F-002（スクリプト）に移ることを ADR に記録する。
F-001 は「スクリプトが扱わない判断事項のチェックリスト」として残す。

## Acceptance

- クリーンな fork に対して `shopify app config link` 後、
  `node scripts/init-new-app.mjs --confirm-fork` 一発（+ Partner Dashboard 操作）で F-001 の Acceptance を満たせる
- プレースホルダ（`client_id = "000..."` / `https://example.com`）残存時に fail-fast する
- 既存 `.env` の `SHOP_TOKEN_ENCRYPTION_KEY` は既定で保持され、明示 rotation なしの上書き入力は fail-fast する

## Validation

- `pnpm check`
- fork のドライラン（別ディレクトリへ clone して実行）
