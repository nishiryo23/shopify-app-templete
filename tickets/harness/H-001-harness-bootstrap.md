# H-001 Harness bootstrap

## Objective
Repo 内の Codex ハーネスを Product Domain Parity MVP 前提で整える。

## Read first
- `AGENTS.md`
- `docs/codex_harness_bootstrap.md`
- `.agent/PLANS.md`
- `.agents/skills/harness-bootstrap/SKILL.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Scope
- root AGENTS guidance の整備
- .agents/skills/* の整備
- adr/ と template の整備
- tickets/README.md の整備
- CODEX_START_PROMPT.md の整備

## Out of scope
- platform/product 実装
- billing / webhook business logic

## ADR impact
Create or confirm `adr/0001-repo-truth-and-codex-harness.md`.

## Acceptance
- Codex skills are under `.agents/skills/<skill-name>/SKILL.md`
- root guidance references ADR workflow
- starting prompt sends Codex to harness tickets first

## Validation
- file tree review
- markdown lint or equivalent
