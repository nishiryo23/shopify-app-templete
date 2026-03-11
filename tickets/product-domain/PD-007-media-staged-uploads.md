# PD-007 Media staged uploads

## Objective
media import/update を staged upload ベースで追加する。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- staged upload flow
- media preview/write/verify
- artifact handling for media source references

## Out of scope
- DAM/file management beyond product media

## ADR impact
Update ADR-0005 or infra ADR if storage truth changes.

## Acceptance
- media rows can be processed end-to-end
- verification covers final attached media state

## Validation
- integration test
- targeted smoke
