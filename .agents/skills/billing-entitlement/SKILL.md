---
name: billing-entitlement
description: Use when changing pricing, hosted plan flow, welcome-link behavior, entitlement mapping, or billing state transitions.
---

# Billing entitlement

## Truth（ADR-0027。旧 ADR-0003 の currentAppInstallation truth は superseded）
- Shopify App Pricing（旧 Managed Pricing）is the billing model
- entitlement truth is **Partner API `activeSubscription(appId, shopId)`**, not redirect, webhook arrival, or Admin API `currentAppInstallation`（deprecated — billing truth に使用禁止）
- appId is `SHOPIFY_APP_GID`（gid://shopify/App/...）; shopId is `Shop.shopGid`（gid://shopify/Shop/...、認証済み bootstrap で取得・保存）
- Partner API endpoint: `https://partners.shopify.com/{PARTNER_API_ORG_ID}/api/2026-07/graphql.json`, auth header `X-Shopify-Access-Token: PARTNER_API_ACCESS_TOKEN`
- reads go through the **entitlement resolver**（DB snapshot + TTL 約10分）: TTL 内は snapshot、TTL 超過で Partner API refresh、失敗時は直近 snapshot へ fallback（主要フローをブロックしない）
- **例外**: review-request open path は forceRefresh + stale fallback 禁止（live check 失敗時は redirect しない。ADR-0026/0027）
- plan selection return redirect carries `plan_handle` + `shop`（`charge_id` は来ない）and is a **forced-refresh trigger only**
- サブスクリプション変更 webhook（`app_subscriptions/update`）は 2026-04-28 以降送信されない。trigger にもできない
- plan selection deep link (`admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans`) is a trigger only; URL truth is `domain/billing/managed-pricing-url.mjs`
- app handle comes from optional `SHOPIFY_APP_HANDLE` env; render no CTA when it is unset or the shop uses a custom domain

## Required mapping
- paid 判定は **plan handle allowlist**（公開プラン handle + `BILLING_TEST_PLAN_HANDLES`）に `activeSubscription.items[].handle` が含まれるか。status 単体で `ACTIVE_PAID` にしない
- `activeSubscription === null` -> `NOT_ENTITLED`
- 状態表現の詳細（trial / pendingUpdate 等）は ADR-0027 の決定に従う
