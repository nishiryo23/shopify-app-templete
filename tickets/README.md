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

### Phase PD: Product Domain Parity MVP
11. `tickets/product-domain/PD-001-product-export-foundation.md`
12. `tickets/product-domain/PD-002-upload-provenance-preview-engine.md`
13. `tickets/product-domain/PD-003-product-core-write-verify-undo.md`
14. `tickets/product-domain/PD-004-variants-pipeline.md`
15. `tickets/product-domain/PD-005-prices-and-compare-at.md`
16. `tickets/product-domain/PD-006-inventory-pipeline.md`
17. `tickets/product-domain/PD-007-media-staged-uploads.md`
18. `tickets/product-domain/PD-008-product-metafields-and-seo.md`
19. `tickets/product-domain/PD-009-manual-collections-membership.md`
20. `tickets/product-domain/PD-010-handle-changes-and-redirects.md`
21. `tickets/product-domain/PD-011-xlsx-support.md`
22. `tickets/product-domain/PD-012-matrixify-compatibility-subset.md`

### Phase O: Operability and launch
23. `tickets/operability/O-001-observability-telemetry-retention-sweeps.md`
24. `tickets/operability/O-002-app-review-readiness-and-release-gate.md`
