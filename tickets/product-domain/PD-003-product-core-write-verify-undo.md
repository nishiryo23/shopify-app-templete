# PD-003 Product core write, verify, undo

## Objective
product core fields の write/verify/undo を完成させる。

## Read first
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- owner-only confirm
- snapshot
- bulk write
- final-state verification
- undo

## Out of scope
- variants/inventory/media/metafields

## ADR impact
Update ADR-0005 if write truth changes.

## Acceptance
- write success is based on final-state verification
- owner-only confirm is enforced
- undo supports latest successful job only

## Validation
- integration tests
- manual happy-path smoke
