# H-003 Contract tests for billing, webhook, provenance helpers

## Objective

危険度の高い truth を contract tests へ落とす。

## Read first

- `docs/template_scope.md`
- `.agents/skills/billing-entitlement/SKILL.md`
- `.agents/skills/webhook-safety/SKILL.md`

## Scope

- billing state mapping tests
- webhook HMAC/idempotency tests
- `domain/provenance` のユニット契約（CSV manifest / signing が将来のドメインで再利用できること）

## Out of scope

- UI polish
- ドメイン固有ワークフロー

## ADR impact

Update ADR-0003/0004 if truth mapping changes. Provenance は 0007 の鍵分離方針に従う。

## Acceptance

- billing mapping tests cover ACTIVE/PENDING/FROZEN/terminal statuses
- webhook duplicate no-op is tested
- tampered CSV manifest is rejected in `csv-provenance` contract tests

## Validation

- unit/integration tests
- `pnpm check`
