# ADR-0024 API version single truth and CI gate

- Status: Accepted
- Date: 2026-06-12
- Owners: template maintainers

## Context

Admin API バージョンが `app/shopify.server.ts`（`ApiVersion.January26` = `2026-01`）と `shopify.app.toml` の `webhooks.api_version`（`2026-04`）で食い違っていたが、どの契約テストも同期を検証していなかった。また、検証ゲート `pnpm check` を強制する CI が存在せず、エージェントがゲートを飛ばしても止まらない状態だった。truth を repo に置く方針（ADR-0001）に対して、truth の同期と実行強制の両方が欠けていた。

## Decision

- **API version の truth は `app/shopify.server.ts` の `ApiVersion` とする。** `shopify.app.toml` の `webhooks.api_version` はこれと同一バージョンに揃える（現在 `2026-01`）。
- 同期は `tests/contracts/shopify-config.contract.test.mjs` で機械検証する。contract test 内の静的 map（enum 名 → バージョン文字列）で照合し、バージョン更新時は server / toml / map の 3 点を同時に更新させる。
- **CI gate**: `.github/workflows/ci.yml` が push（main）と pull_request で `pnpm check` を実行する。DB・Playwright ブラウザ・Shopify 資格情報を必要としない構成を維持する（smoke は `--list` のみ）。
- 未使用依存 `@shopify/app-bridge-react` を削除する（App Bridge は `@shopify/shopify-app-react-router` の `AppProvider` が script 注入で提供し、npm パッケージはどこからも import されていない）。

## Consequences

- 得られるもの: API バージョン不整合の再発防止。`pnpm check` の CI 強制。依存の最小化。
- 失うもの: バージョン更新時に 3 箇所（server / toml / contract map）の同時更新が必要になる（意図的な摩擦）。
- 後続タスク: API バージョンを上げる際は本 ADR に従い 3 点同時更新の diff を作る。

## Alternatives considered

- **toml を truth にする**: ランタイム挙動を決めるのはコード側の `ApiVersion` であり、toml を truth にすると実行時との乖離を検出できないため不採用。
- **パッケージの enum を import して照合**: contract test がライブラリ内部に依存し、バージョン更新の検知が暗黙化するため、静的 map による明示的な照合を採用。

## References

- `tickets/harness/H-017-ci-gate-and-config-sync.md`
- `.github/workflows/ci.yml` / `tests/contracts/ci-workflow.contract.test.mjs`
- ADR-0001（repo truth）, ADR-0004（webhook 方針）
