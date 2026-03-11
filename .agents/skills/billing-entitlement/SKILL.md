---
name: billing-entitlement
description: Use when changing pricing, hosted plan flow, welcome-link behavior, entitlement mapping, or billing state transitions.
---

# Billing entitlement

## Truth
- Managed Pricing is the billing model
- entitlement truth is Shopify query, not redirect or webhook arrival
- welcome link and `app_subscriptions/update` are triggers only

## Required mapping
- `ACTIVE` -> `ACTIVE_PAID`
- `PENDING` -> `PENDING_APPROVAL`
- `FROZEN` -> `PAYMENT_HOLD`
- terminal statuses -> no paid entitlement
