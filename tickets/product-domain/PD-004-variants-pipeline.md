# PD-004 Variants pipeline

## Objective
variants create/update/delete を Product Domain Parity MVP に追加する。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- variant schema
- variant preview/write/verify
- variant-specific error mapping

## Out of scope
- inventory quantities
- media

## ADR impact
Update ADR-0005 if variant boundary changes.

## Acceptance
- variant rows can be previewed and written
- final-state verification covers variants

## Validation
- integration test
- targeted smoke
