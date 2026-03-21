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

## Consequences
billing drift を query-based に収束できる。
