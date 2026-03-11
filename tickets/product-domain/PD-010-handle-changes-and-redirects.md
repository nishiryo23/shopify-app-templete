# PD-010 Handle changes and redirects

## Objective
handle change と redirect 作成を連動させる。

## Read first
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- handle update contract
- redirect write/verify
- preview impact

## Out of scope
- sitewide URL management outside product-linked redirects

## ADR impact
Update ADR-0005 if redirect semantics change.

## Acceptance
- handle changes can create verified redirects
- rollback/undo semantics are explicit

## Validation
- integration tests
