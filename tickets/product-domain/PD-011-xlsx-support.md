# PD-011 XLSX support

## Objective
CSV に加えて XLSX を launch scope へ追加する。

## Read first
- `docs/shopify_app_requirements_definition_complete.md`
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- XLSX import/export adapter
- worksheet contract
- same preview/write truth as CSV

## Out of scope
- Google Sheets connector

## ADR impact
Update ADR-0005 if file contract changes.

## Acceptance
- XLSX round-trip works for launch scope resources
- preview/write semantics remain identical to CSV

## Validation
- unit/integration tests
