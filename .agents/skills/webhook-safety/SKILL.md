---
name: webhook-safety
description: Use when implementing or changing HTTPS webhooks, raw-body/HMAC validation, dedupe, inbox, compliance topics, uninstall, or redact handling.
---

# Webhook safety

## Rules
- HTTPS only in v1
- raw body must survive until HMAC verification
- invalid HMAC -> 401, no side effects
- duplicate event -> 200 no-op
- 200 only after durable inbox write and enqueue
- business logic is async
- app-specific webhooks only in v1

## Compliance
- `customers/data_request`
- `customers/redact`
- `shop/redact`
- `app/uninstalled`
