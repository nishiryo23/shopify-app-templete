# PD-001 Product export foundation

## Objective
Product Domain Parity MVP の export contract を実装する。

## Read first
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- product export route/job
- export manifest
- source artifact
- CSV contract

## Out of scope
- preview/write/undo
- non-product domains

## ADR impact
Update ADR-0005 if export truth or scope changes.

## Acceptance
- product export job can be created
- manifest and row fingerprints are generated
- source artifact is stored

## Validation
- integration test
- artifact smoke
