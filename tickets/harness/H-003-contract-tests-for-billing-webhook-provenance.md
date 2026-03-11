# H-003 Contract tests for billing, webhook, provenance

## Objective
危険度の高い truth を contract tests へ落とす。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/billing-entitlement/SKILL.md`
- `.agents/skills/webhook-safety/SKILL.md`
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- billing state mapping tests
- webhook HMAC/idempotency tests
- CSV manifest/fingerprint provenance tests

## Out of scope
- UI polish
- full product workflow

## ADR impact
Update ADR-0003/0004/0005 if truth mapping changes.

## Acceptance
- billing mapping tests cover ACTIVE/PENDING/FROZEN/terminal statuses
- webhook duplicate no-op is tested
- tampered provenance is rejected in tests

## Validation
- unit/integration tests
- `pnpm check`
