# Ticket execution order

## Phase 0 — Harness first
- H-001 AGENTS / plans / repo pointers
- H-002 Architecture lint and hard guards
- H-003 Contract and smoke test skeletons
- H-004 CI quality gates

## Phase 1 — Platform foundation
- P-001 Embedded shell and App Bridge/Polaris baseline
- P-002 Session token auth and invalid session handling
- P-003 Shop bootstrap and scope truth
- P-004 Billing entitlement refresh and pricing gate
- P-005 Webhook ingress, inbox, idempotency
- P-006 Uninstall / redact lifecycle

## Phase 2 — Product GA workflow
- G-001 Product export + manifest
- G-002 Product import upload + provenance validation
- G-003 Preview generation
- G-004 Confirm + snapshot + bulk write
- G-005 Final-state verification
- G-006 Undo

Only one ticket at a time.
Do not start a later ticket until the current ticket passes its checks.
