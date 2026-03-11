# PD-002 Upload, provenance, preview engine

## Objective
closed-loop upload と preview engine を Product Domain Parity MVP 対象へ拡張する。

## Read first
- `.agents/skills/product-domain-parity/SKILL.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`

## Scope
- upload ingress
- manifest verify
- row fingerprint verify
- preview summary/read model

## Out of scope
- write execution

## ADR impact
Update ADR-0005 if preview truth or scope changes.

## Acceptance
- tampered file is rejected
- preview can classify changed/unchanged/error/warning
- preview artifact is stored

## Validation
- integration test
- preview smoke
