# ADR-0027 Partner API billing entitlement truth

- Status: Accepted
- Ticket: P-010
- Supersedes: ADR-0003 for billing entitlement truth

## Context
Shopify App Pricing の billing truth は、2026-04-28 以降の subscription update webhook 廃止と Admin API `currentAppInstallation` billing usage の deprecation を前提に見直す必要がある。

ADR-0003 の query-based truth という方針は維持するが、query 先は Admin API ではなく Partner API `activeSubscription(appId, shopId)` に置き換える。

## Decision
- entitlement truth は Partner API `activeSubscription(appId, shopId)` とする。ADR-0003 の `currentAppInstallation.activeSubscriptions` / `allSubscriptions` を billing truth にする設計は旧仕様として扱う。
- resolver は DB snapshot + TTL 約 10 分で動かす。TTL 内は DB snapshot を返し、snapshot 未作成または TTL 超過時だけ Partner API refresh を試みる。
- Partner API endpoint は `https://partners.shopify.com/{organization_id}/api/2026-07/graphql.json` とする。`organization_id` は必須 env `PARTNER_API_ORG_ID` で受け取る。
- Partner API 認証は `X-Shopify-Access-Token` header に `PARTNER_API_ACCESS_TOKEN` を入れる。`Authorization: Bearer` は使わない。
- Partner API refresh が失敗した場合、直近 snapshot があれば TTL 切れでも fallback して主要フローを止めない。fallback 発生は warn log に残す。HTTP 429 は rate limit として識別して warn/fallback する。snapshot が存在しない場合は fail-fast し、設定不足や初回 refresh 失敗を黙って Free 扱いにしない。
- review prompt gate は主要フロー fallback の例外とする。review-request open path は `forceRefresh` かつ stale fallback 禁止で live Partner API entitlement を確認し、live check に失敗した場合は review redirect せず `/app` に戻す。
- refresh stampede を抑えるため、TTL 切れ snapshot の refresh 書き込みは `checkedAt` が refresh 開始時点の snapshot 以下の場合だけ条件付き更新する。別 request が先に新しい snapshot を保存した場合は、その新しい snapshot を返す。
- 有料判定は `activeSubscription.items[].handle` の plan handle allowlist 方式とする。公開有料 plan handle は `standard`、テスト用 handle は `BILLING_TEST_PLAN_HANDLES` のカンマ区切りで追加する。subscription status 単体で `ACTIVE_PAID` とは判定しない。
- Partner API query は公式 `activeSubscription` shape に合わせる。subscription identity は `legacySubscriptionId` を取得し、`id` は取得しない。`currentBillingCycle` は `startTime` / `endTime`、`pendingUpdate` は `billingPeriod` / `items { handle }` / `legacySubscriptionId`、`items[].price` は Price interface の `__typename` / `active` / `currency` と `FlatRatePrice.amount` / `TieredPrice.tiersMode` + `tiers { upTo amountPerUnit amount }` inline fragment を取得する（`tiers` は `[PriceTier!]!` のためサブフィールド選択が必須）。旧 Admin API `AppSubscription` 風の `plan.handle` / `status` / `name` / `test` や、存在しない `startsAt` / `endsAt` / `effectiveAt` / `price.currencyCode` は取得しない。
- `activeSubscription` が `null` の場合は `NOT_ENTITLED` とする。`items[].handle` が allowlist に含まれる場合だけ `ACTIVE_PAID` とする。Partner API のこの shape で直接表現できる `legacySubscriptionId`、`trialEndsAt`、`currentBillingCycle`、`pendingUpdate`、Price interface payload は `BillingEntitlementSnapshot` に保存して表示・監査用に残すが、entitlement state は変えない。frozen / cancelled / declined / expired のようにこの shape で取得できない状態は local entitlement state として表現しない。
- Partner API の `appId` は必須 env `SHOPIFY_APP_GID` を使い、形式は `gid://shopify/App/...` とする。`shopId` は `gid://shopify/Shop/...` 形式で、認証済み Admin API bootstrap 境界で `shop { id }` を取得し `Shop.shopGid` snapshot に保存する。billing resolver は保存済み snapshot を使い、参照ごとに Admin API を叩かない。
- plan selection からの戻りは `plan_handle` + `shop` query parameter だけを強制 refresh trigger とする。`charge_id` は使わない。`plan_handle` は trigger であり truth ではないため、受信値で entitlement を直接更新しない。
- 戻り redirect の `shop` は、認証済み session shop と一致する場合だけ強制 refresh を許可する。handle 形式（`example`）は `example.myshopify.com` に正規化して比較する。
- `SHOPIFY_APP_HANDLE` は plan selection deep link 表示用の optional env のまま維持する。未設定または custom domain では CTA を出さない。
- `BillingEntitlementSnapshot` は app uninstall と `shop/redact` の両方で shop-bound data として削除する。削除しない場合、redact 後や同一 `shopDomain` の再インストールで古い `ACTIVE_PAID` snapshot を返し得るため、snapshot fallback の対象からも外す。

## Consequences
subscription webhook 到着や redirect parameter を billing truth にしないため、非同期遅延や forged query parameter による権限昇格を避けられる。

既存 installation に snapshot がない状態で `PARTNER_API_ACCESS_TOKEN`、`PARTNER_API_ORG_ID`、`SHOPIFY_APP_GID`、または `Shop.shopGid` が未設定の場合、初回 entitlement refresh は失敗する。これは misconfiguration を早期検出するための意図的な fail-fast であり、snapshot が作成済みの shop では Partner API 障害時も直近 state へ fallback する。既存 shop の `Shop.shopGid` は次回の認証済み bootstrap で補完される。

## Rejected
- `currentAppInstallation` billing query の継続利用: deprecated であり、新規 billing truth として残すと旧仕様との混在が起きる。
- `ACTIVE` status 単体での有料判定: Free や private test plan を含む plan 構成で誤判定が起きるため採用しない。
- `plan_handle` redirect parameter を truth として保存する: merchant が戻り URL を直接開いた場合でも entitlement が変わってしまうため採用しない。
