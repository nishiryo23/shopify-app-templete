# O-001 Observability, telemetry, retention sweeps

## Objective
launch 前に監視・retention・redact と整合する telemetry を完成させる。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/app-review-readiness/SKILL.md`

## Scope
- structured logs
- metrics
- alerts
- redactable vs pseudonymous telemetry
- retention sweeps

## Out of scope
- feature scope changes

## ADR impact
Update ADR if telemetry truth changes.

## Acceptance
- 7日超 telemetry に shop-identifiable data が残らない
- critical alerts are defined and testable

## Validation
- synthetic alert tests
- retention sweep smoke
