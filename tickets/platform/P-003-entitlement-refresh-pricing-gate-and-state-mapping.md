# P-003 Entitlement refresh, pricing gate, and state mapping

## Objective
Managed Pricing の hosted flow と entitlement state machine を実装する。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/billing-entitlement/SKILL.md`

## Scope
- `currentAppInstallation` query service
- local state mapping
- `/app/pricing`
- `/app/welcome`
- API refresh endpoint

## Out of scope
- product feature internals

## ADR impact
Confirm ADR-0003 or update if mapping changes.

## Acceptance
- welcome link does not grant entitlement by itself
- ACTIVE/PENDING/FROZEN/terminal statuses map correctly
- pricing gate reflects local entitlement state

## Validation
- unit/integration tests
- pricing smoke
