---
doc_type: guideline
authority: supporting
truth_sources:
  - docs/platform-truth-index.md
  - tickets/README.md
---

# Shopify Review Promotions（派生repo→テンプレ昇格キュー）

派生アプリの審査・実装で得た再利用可能な知見を記録し、テンプレへ昇格させるためのキュー。
allergy / factory の同名ファイルと同じ運用。昇格したら該当行を「済」にし ticket 番号を残す。

運用ルール:

- 派生 repo での審査対応・実装完了時に、汎用化できる知見をここへ 1 行追加する（出典パス必須）。
- 昇格は ticket 化してから行う（`tickets/README.md` の Operating rules に従う）。
- 昇格済みの行は削除せず「済 (ticket-id)」にして履歴として残す。

## 昇格キュー（2026-07-05 テンプレレビューで初期投入）

| 候補 | 出典 | 工数 | 状態 |
|---|---|---|---|
| embedded-app-navigation utility（shop/host/embedded クエリ保持） | allergy `app/utils/embedded-app-navigation.ts` | S | 未 |
| NavMenu を app-bridge-react 公式コンポーネントへ追従 | allergy `app/routes/app.tsx` | S | 未 |
| verify-production-runtime（本番起動実検証を pnpm check へ） | allergy `scripts/verify-production-runtime.mjs` | S | 未 |
| Heroku 最小デプロイ runbook + Procfile（審査用低コスト経路） | allergy `docs/heroku_minimal_deployment.md` / allergy ADR-0045 | S | 未 |
| API バージョン bump 運用（toml + ApiVersion + contract 一括更新の手順化） | allergy が 2026-04 に先行（テンプレは 2026-01） | S | 未 |
| Theme App Extension スケルトン（design_mode / locales / metafield 読出し） | allergy `extensions/allergen-display/` | M | 未 |
| 型付き metafield 定義レジストリ（as const satisfies） | allergy `domain/allergens/metafield-definitions.ts`、carelabel / clearlot 同型 | S | 未 |
| CSV preview→確認→apply 状態機械 + タイムアウト予算 | allergy `domain/csv/`、shipping-gurd の worker 版 | M〜L | 未 |
| 無料プラン境界（plan-features） | japanese-search `domain/billing/plan-features.mjs` | M | 未 |
| 設定ページ型（Tabs + SaveBar + ライブプレビュー） | carelabel `app/routes/app.settings.tsx`、allergy `app.settings_.display.tsx` | M | 未 |
| multi-extension CI（TAE + Checkout UI + Function の build ゲート） | shipping-gurd `.github/workflows/ci.yml` | S〜M | 未 |
| Chrome E2E シナリオ検証（validate-chrome-smoke-scenarios） | allergy `scripts/validate-chrome-smoke-scenarios.mjs` + `tests/chrome/` | M | 未 |
| shopify.app.development.toml 2-config 運用（config 分離のみ。PCD / domain webhook の分離は F-002 では扱わず、必要な派生アプリ側の domain ticket + ADR で検討する） | allergy / factory | S | 未 |
| app config 同期スクリプト（client_id / env 同期） | factory `scripts/sync-shopify-app-config.ts`、receipt `scripts/write-shopify-app-config.mjs` | M | 未 |
| mvp_out_of_scope.md（テンプレ機能を消さず理由付きで眠らせる文書型） | allergy `docs/mvp_out_of_scope.md` | S | 未 |
| review-metadata の UNCONFIGURED_BEFORE_SUBMISSION 規律（推測値を入れない） | allergy `docs/app-review-metadata.md` | S | 未 |
