---
name: webhook-safety
description: Use when a task touches webhook routes, HMAC validation, inbox/idempotency, app/uninstalled, compliance topics, or redact.
---
Required invariants:
- HTTPS webhooks only
- app-specific topics only
- raw body invariant until HMAC validation completes
- durable enqueue before 200
- duplicate deliveries are 200 no-op
- compliance topics are TOML-managed
