# ADR-0003 Managed pricing as billing source of truth

- Status: Accepted

## Context
welcome link と webhook は遅延・非同期のため、billing truth を別に持つ必要がある。

## Decision
- Managed Pricing を採用
- entitlement truth は `currentAppInstallation`
- welcome link と `app_subscriptions/update` は trigger only
- `AppSubscriptionStatus.ACCEPTED` は deprecated でも enum に残るため、launch harness では non-terminal として `PENDING_APPROVAL` へ寄せる

## Consequences
billing drift を query-based に収束できる。
