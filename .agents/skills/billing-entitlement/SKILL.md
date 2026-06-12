---
name: billing-entitlement
description: Use when changing pricing, hosted plan flow, welcome-link behavior, entitlement mapping, or billing state transitions.
---

# Billing entitlement

## Truth
- Managed Pricing is the billing model
- entitlement truth is Shopify query, not redirect or webhook arrival
- welcome link and `app_subscriptions/update` are triggers only
- plan selection deep link (`admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans`) is a trigger only; URL truth is `domain/billing/managed-pricing-url.mjs`
- app handle comes from optional `SHOPIFY_APP_HANDLE` env; render no CTA when it is unset or the shop uses a custom domain

## Required mapping
- `ACTIVE` -> `ACTIVE_PAID`
- `PENDING` -> `PENDING_APPROVAL`
- `FROZEN` -> `PAYMENT_HOLD`
- terminal statuses -> no paid entitlement
