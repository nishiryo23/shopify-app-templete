# ADR-0003 Managed pricing as billing source of truth

- Status: Accepted

## Context
welcome link と webhook は遅延・非同期のため、billing truth を別に持つ必要がある。

## Decision
- Managed Pricing を採用
- entitlement truth は `currentAppInstallation`
- P-003 では `currentAppInstallation.activeSubscriptions` を優先し、空配列時のみ `allSubscriptions` の最新 1 件を fallback として読む
- welcome link と `app_subscriptions/update` は trigger only
- local persistence は cache であって entitlement truth ではない
- `activeSubscriptions` が複数返った場合は異常系として記録しつつ先頭要素で gate 判定を継続する
- `activeSubscriptions` が空でも hosted pricing の承認待ち状態を失わないため、fallback は「より古い non-terminal を探す」のではなく最新 1 件そのものを採用する
- `AppSubscriptionStatus.ACCEPTED` は deprecated でも enum に残るため、launch harness では non-terminal として `PENDING_APPROVAL` へ寄せる
- 管理画面の billing / welcome 表示は日本語ラベルを優先し、必要時のみ raw state code を補助表示する
- 日本語化は表示層の責務とし、`ACTIVE_PAID` などの internal state value と query-based billing truth は変更しない
- pricing / welcome route の UI 実装は Polaris component や埋め込み shell 用 custom element を使ってよいが、presentation 変更だけで entitlement mapping や refresh contract を変えない

### Plan selection deep link（P-007 追記）

- pricing 画面は Managed Pricing の plan selection ページ（`https://admin.shopify.com/store/{storeHandle}/charges/{appHandle}/pricing_plans`）への deep link CTA を持つ。deep link は **trigger only** であり、遷移・承認は entitlement を変えない。truth は引き続き `currentAppInstallation` query。
- app handle のランタイム truth は `SHOPIFY_APP_HANDLE` 環境変数（optional）。未設定時は CTA を描画しない（テンプレ既定では handle が存在しないため必須化しない）。
- store handle は `session.shop` の `.myshopify.com` suffix 除去で導出する。custom domain（suffix 不一致）では deep link を出さず安全側に倒す。
- URL 組み立ては `domain/billing/managed-pricing-url.mjs` の純粋関数を正本とし、route へは `app/services/billing.server.ts` の loader data（`planSelectionUrl`）経由で渡す。

## Consequences
billing drift を query-based に収束できる。未契約 merchant は pricing 画面から hosted plan selection へ到達でき、承認後は既存の refresh 導線で entitlement を再確認する。
