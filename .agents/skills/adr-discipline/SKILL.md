---
name: adr-discipline
description: Use when a ticket changes architecture, source-of-truth, lifecycle, billing, webhooks, retention, route contract, state machine, or infrastructure selection.
---

# ADR discipline

## ADR is required when
- install / reinstall / auth changes
- session token or token exchange changes
- billing truth or plan transitions change
- webhook registration / ingress / idempotency changes
- privacy / retention / redact changes
- state machine or route contract changes
- infrastructure selection changes
- launch scope boundary changes

## Output
- new `adr/NNNN-short-title.md` or update existing ADR
- reference ADR number in the ticket summary
