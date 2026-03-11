# PD-005 Prices and compare-at

## Objective
variant price/compare-at 更新を pipeline に追加する。

## Read first
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- price fields in schema
- preview semantics
- write/verify semantics

## Out of scope
- inventory
- markets/B2B pricing

## ADR impact
Update ADR-0005 if price scope changes.

## Acceptance
- price changes are previewable
- write and verify work for prices/compare-at

## Validation
- unit + integration tests
