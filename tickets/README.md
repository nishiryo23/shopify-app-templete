# Tickets

## Operating rules

- **1 session = 1 ticket**
- complete harness tickets first
- create `plans/<ticket-id>.md` before implementation
- create or update an ADR when the ticket changes architecture or source-of-truth
- after implementation, run the ticket validation and record the ADR number used

## Execution order

### Phase H: Harness first

1. `tickets/harness/H-001-harness-bootstrap.md`
2. `tickets/harness/H-002-quality-gates-and-architecture-guardrails.md`
3. `tickets/harness/H-003-contract-tests-for-billing-webhook-provenance.md`
4. `tickets/harness/H-004-playwright-and-dev-store-smoke-scaffolding.md`

### Phase P: Platform foundation

5. `tickets/platform/P-001-embedded-shell-and-session-auth.md`
6. `tickets/platform/P-002-shop-bootstrap-offline-token-scope-truth.md`
7. `tickets/platform/P-003-entitlement-refresh-pricing-gate-and-state-mapping.md`
8. `tickets/platform/P-004-webhooks-uninstall-redact-lifecycle.md`
9. `tickets/platform/P-005-db-queue-artifact-crypto-foundation.md`
10. `tickets/platform/P-006-aws-infra-bootstrap.md`

### Phase O: Operability and launch

11. `tickets/operability/O-001-observability-telemetry-retention-sweeps.md`
12. `tickets/operability/O-002-app-review-readiness-and-release-gate.md`

## ドメイン機能

商品バルク等の旧 ticket は `adr/archive/product-domain/` に対応する ADR とともにアーカイブ済み。新規ドメインは `.agents/skills/domain-feature-stub/SKILL.md` を複製してから ticket を追加する。
