# PD-006 Inventory pipeline

## Objective
inventory quantity 更新を launch scope に追加する。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- inventory scopes and service
- inventory preview/write/verify
- location handling contract

## Out of scope
- orders/fulfillment flows

## ADR impact
Update ADR-0005 if inventory truth changes.

## Acceptance
- inventory updates require correct scope and verification
- location contract is explicit and tested

## Validation
- integration test
- inventory smoke
