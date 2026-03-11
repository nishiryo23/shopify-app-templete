# P-002 Shop bootstrap, offline token, scope truth

## Objective
install/reinstall 後に shop state と offline token と granted scopes truth を確立する。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/shopify-lifecycle/SKILL.md`

## Scope
- Shop bootstrap
- non-expiring offline token bootstrap
- scope truth via `currentAppInstallation.accessScopes`

## Out of scope
- pricing gate
- webhook lifecycle

## ADR impact
Update ADR-0002 if lifecycle truth changes.

## Acceptance
- fresh install creates/updates shop state
- reinstall uses fresh bootstrap
- offline token is stored encrypted
- scope truth is query-based

## Validation
- integration test
- reinstall smoke
