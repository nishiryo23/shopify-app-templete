# H-002 Quality gates and architecture guardrails

## Objective
Codex が迷いやすい境界を lint / check script で固定する。

## Read first
- `AGENTS.md`
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/product-domain-parity/SKILL.md`

## Scope
- `pnpm check` の整備
- routes -> service boundary guardrail
- no direct Admin API access guardrail
- no webhook inline business logic guardrail

## Out of scope
- feature implementation beyond stub fixtures

## ADR impact
Update ADR-0001 if the harness truth changes.

## Acceptance
- `pnpm check` exists and fails on boundary violations
- at least one architecture guardrail test or lint rule is added

## Validation
- lint/ast rule smoke
- `pnpm check`
