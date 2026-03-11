---
name: product-domain-parity
description: "Use when implementing launch-scope product features: products, variants, prices, inventory, media, metafields, SEO, manual collections, handle changes, redirects, CSV/XLSX preview/write/verify/undo."
---

# Product Domain Parity MVP

## Launch GA scope
- product core fields
- variants
- prices / compare-at
- inventory
- media
- product metafields
- SEO
- manual collections
- handle change + redirects
- CSV / XLSX
- preview / verify / undo

## Out of scope
- orders
- customers
- discounts
- connectors
- scheduling
- store copy

## Guardrails
- write success is final-state verification, not mutation completion alone
- ticket granularity should stay narrow: one domain slice per ticket
