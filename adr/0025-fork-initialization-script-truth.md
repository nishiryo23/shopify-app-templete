# ADR-0025 Fork initialization script truth

- Status: Accepted
- Date: 2026-07-05
- Owners: template maintainers

## Context

F-001 は fork 先で実行する手動 checklist として、アプリ識別子、URL、`SHOPIFY_APP_HANDLE`、review metadata、`.env`、検証手順をまとめていた。一方で fork 時の必須置換は複数ファイルにまたがり、`SHOPIFY_APP_HANDLE` の 3 箇所同期や `https://example.com` / `UNCONFIGURED_BEFORE_SUBMISSION` の残存を人手で検出する運用では drift が起きやすい。

F-002 はテンプレ本体に `scripts/init-new-app.mjs` を追加し、fork 先での反復作業を 1 コマンドに寄せる。テンプレ本体の `shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract は変えず、fork 先で値を差し込むための導線だけを追加する。

Shopify CLI の `app config link` は Developer Dashboard から app configuration を取得し、configuration file を作成または上書きする。したがって link を script 実行後の follow-up に置くと、script が書いた `application_url` / `redirect_urls` が失われ得る。

`SHOP_TOKEN_ENCRYPTION_KEY` は encrypted offline token を復号する正本であり、既存 `.env` に設定済みの値を fork 初期化 script が暗黙に置換すると、既存 shop の offline token を復号不能にする。

## Decision

- fork 初期化手順の primary source-of-truth は F-002 の `scripts/init-new-app.mjs` と contract test に移す。
- F-001 は script が扱わない判断事項の checklist として残す。Partner Dashboard でのアプリ作成、production `shopify app config link`、GitHub vars、task definition、scope 追加判断、dev store smoke は引き続き人が確認する。
- production `shopify app config link` は script 実行前の必須 preflight にする。Shopify CLI の `--config` は file path ではなく app configuration name なので、default の `shopify.app.toml` を link する通常手順は bare command を正本にする。script は link 後の `shopify.app.toml` に対して `application_url` / `redirect_urls` を書き込み、`shopify.app.development.toml` parity と残プレースホルダを再検証する。
- script は `--confirm-fork` を必須にし、canonical template checkout または未リンクテンプレートでは書き込み前に fail-fast する。
- script はアプリ名、Shopify app handle、本番 URL、review metadata を入力として受け取り、`.env`、docs、`shopify.app.development.toml` を fork 先で生成または更新する。本番 URL は OAuth redirect の基点なので origin-only の HTTPS URL に限定し、privacy policy URL は userinfo を拒否する。
- `client_id` は script で扱わず、Shopify CLI の `shopify app config link` に委譲する。
- `.env` に既存 `SHOP_TOKEN_ENCRYPTION_KEY` がある場合は既定で保持する。未設定時のみ `node:crypto` の `randomBytes(32).toString("base64")` で生成し、既存 key の rotation は `--rotate-shop-token-key` 明示時だけ許可する。
- 明示 rotation なしで既存 key と異なる `--shop-token-encryption-key` / env 入力が来た場合は fail-fast する。
- `shopify.app.development.toml` の webhook / scope 内容は生成元の `shopify.app.toml` と同一に保つ。scope 追加やドメイン webhook は派生アプリ側の domain ticket + ADR で扱う。
- プレースホルダ残存検査、config link preflight、canonical checkout no-write、未リンクテンプレート no-write、secret 保持 / rotation は `scripts/init-new-app.mjs` と `tests/contracts/fork-init-script.contract.test.mjs` で機械化する。

## Consequences

得られるものは、fork 初期化時の URL / handle / review metadata の同期漏れを fail-fast できることと、F-001 の acceptance を CI で検査できること。失うものは、F-001 の単純な手作業 checklist だけで完結する軽さだが、script は非対話モードにも対応させて automation に組み込める。

既存インストールへの影響はない。今回の変更はテンプレ本体に script、contract、docs/ADR 参照を追加するだけで、実行されない限り app config や secrets は変更されない。fork 先で script を再実行する場合も既存 `SHOP_TOKEN_ENCRYPTION_KEY` は既定で保持されるため、明示 rotation なしに既存 encrypted offline token を壊さない。

## Alternatives considered

- F-001 の手動 checklist だけを維持する。
  - 置換対象が `.env`、Shopify config、複数 docs に分散し、レビュー時に残プレースホルダを見落としやすいため不採用。
- Partner Dashboard / GitHub / task definition まで自動更新する。
  - 認証状態や環境ごとの権限が必要になり、ネットワークなしの fork 初期化導線と衝突するため不採用。
- `shopify app config link` を script 実行後の follow-up に残す。
  - 公式 CLI 挙動が config file の作成または上書きなので、script の URL 更新を後続 link が消せるため不採用。
- `SHOP_TOKEN_ENCRYPTION_KEY` を毎回再生成する。
  - encrypted offline token の復号 key を暗黙に変えることになり、既存 shop state を復旧不能にするため不採用。
- scope や domain webhook を script の選択肢に含める。
  - テンプレの minimal empty access scopes baseline と ticket + ADR 運用を壊すため不採用。

## References

- `tickets/template/F-002-fork-init-script.md`
- `tickets/template/F-001-fork-initialization.md`
- `docs/app-review-metadata.md`
- `docs/reviewer-packet.md`
- ADR-0023 Empty minimal access scopes baseline
- Shopify CLI `app config link`: https://shopify.dev/docs/api/shopify-cli/app/app-config-link
