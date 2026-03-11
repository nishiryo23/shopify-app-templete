# P-001 Embedded shell and session auth

## Objective
embedded app shell と session-token based request auth を実装する。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/shopify-lifecycle/SKILL.md`

## Scope
- `/app`, `/app/pricing`, `/app/welcome` shell
- layout auth
- invalid session handling
- Polaris shell

## Out of scope
- billing truth
- product jobs

## ADR impact
Confirm ADR-0002 or update if auth boundaries differ.

## Acceptance
- embedded shell loads in admin
- invalid XHR returns 401 + retry header
- invalid document requests bounce

## Validation
- integration test
- manual embedded smoke
