# P-005 DB, queue, artifact, crypto foundation

## Objective
Product Domain Parity MVP を支える保存・暗号化・非同期基盤を作る。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- Prisma models
- PostgreSQL-backed queue
- artifact storage adapter
- signing/encryption utilities

## Out of scope
- full product feature logic

## ADR impact
Update ADR-0006 if storage/queue/crypto truth changes.

## Acceptance
- queue supports lease/retry/DLQ
- artifact storage is private
- offline token encryption exists
- row fingerprint signing exists

## Validation
- integration tests
- storage adapter smoke
