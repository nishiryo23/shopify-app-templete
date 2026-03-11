# PD-012 Matrixify compatibility subset

## Objective
launch scope 内で Matrixify 互換の列/ファイル subset を受けられるようにする。

## Read first
- `docs/shopify_app_requirements_definition_complete.md`
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- compatibility mapping layer
- supported subset documentation
- import normalization

## Out of scope
- full Matrixify parity across all resources

## ADR impact
Update ADR-0005 if compatibility contract changes.

## Acceptance
- declared subset files import successfully
- unsupported columns fail explicitly, not silently

## Validation
- fixture-based compatibility tests
