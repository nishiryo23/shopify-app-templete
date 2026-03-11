# P-004 Webhooks, uninstall, redact lifecycle

## Objective
fixed HTTPS webhooks と uninstall/redact lifecycle を実装する。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/webhook-safety/SKILL.md`

## Scope
- HTTPS webhook routes
- webhook inbox and dedupe
- `app/uninstalled`
- `app_subscriptions/update`
- compliance topics

## Out of scope
- product feature business logic

## ADR impact
Confirm ADR-0004 or update if webhook truth changes.

## Acceptance
- invalid HMAC returns 401 with no side effects
- duplicates are no-op
- uninstall stops writes
- shop/redact schedules hard delete

## Validation
- integration tests
- webhook smoke
