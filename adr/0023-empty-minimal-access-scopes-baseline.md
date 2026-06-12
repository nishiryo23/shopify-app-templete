# ADR-0023 Empty minimal access scopes baseline

- Status: Accepted
- Date: 2026-06-12
- Owners: template maintainers

## Context

テンプレートの launch 対象は最小プラットフォーム骨格（認証・課金シェル・webhook・worker）だが、`shopify.app.toml` には旧 product-domain 由来の 7 scope（products / inventory / files / online_store_navigation）が残っていた。骨格は実際にはどの Admin API scope も必要としない（`currentAppInstallation` の billing query と webhook 登録は scope 不要）。未使用 scope の要求は least-privilege に反し、App Store 審査の指摘対象にもなる。

## Decision

- テンプレ baseline の access scopes は **空**（`scopes = ""`）とする。
- scope の追加はドメイン機能の ticket + ADR で行う（`shopify.app.toml` / `.env` / deploy workflow の `SCOPES` を同時更新。adr-discipline が ADR 同梱を強制する）。
- `SCOPES` 環境変数は **optional** とする:
  - `app/shopify.server.ts` と `workers/offline-admin.mjs` は空文字・未設定を空配列として扱う（`split(",")` が `[""]` を生む既知バグも修正）。
  - `workers/bootstrap.mjs` の必須 env 検証から `SCOPES` を外す。
  - deploy workflow の必須検証は `SHOPIFY_API_KEY` / `SHOPIFY_APP_URL` のみとし、`SCOPES` は空のまま task definition に渡す。
- granted scope の truth は引き続き `currentAppInstallation.accessScopes` query（ADR-0002）。
- 空 scope baseline では `currentAppInstallation.accessScopes` の結果が空配列になることが正規状態なので、`Shop.grantedScopes: []` は未 bootstrap sentinel にしない。bootstrap freshness は `lastBootstrapAt` の有無で判定する。

## Consequences

- 得られるもの: least-privilege な既定値。審査での未使用 scope 指摘リスクの除去。「scope はドメイン ticket で追加する」運用の明文化。
- 失うもの: fork 直後に商品系 API を叩ける即時性（fork-init ticket で scope 追加手順を案内する）。
- 後続タスク: fork 初期化 ticket（F-001）に scope 追加手順を記載する。

## Alternatives considered

- **`read_products` を例示として 1 つ残す**: 「最小」と矛盾し、未使用 scope が残る根本問題が解決しないため不採用。
- **`[access_scopes]` ブロックごと削除**: 設定の存在自体を消すと fork 時に追記場所が分かりにくい。空文字で「明示的に空」を表現する。CLI が空文字を拒否する場合のみブロック削除へフォールバックする。

## References

- `tickets/platform/P-008-minimal-empty-access-scopes.md`
- ADR-0002（scope truth）, ADR-0021（template scope）
- `tests/contracts/shopify-config.contract.test.mjs` / `tests/contracts/aws-infra-bootstrap.contract.test.mjs`
