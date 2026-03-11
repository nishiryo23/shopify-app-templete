# P-006 AWS infra bootstrap

## Objective
AWS を launch 標準インフラとして起動できる最小構成を作る。

## Read first
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0006-aws-as-launch-infrastructure.md`

## Scope
- ECS Fargate web/worker task definitions
- RDS PostgreSQL connectivity assumptions
- S3/KMS/Secrets Manager wiring plan
- GitHub Actions deploy skeleton

## Out of scope
- full IaC perfection
- production cutover

## ADR impact
Confirm or update ADR-0006.

## Acceptance
- infra bootstrap documents required resources and wiring
- deploy pipeline skeleton exists
- secrets/config split is explicit

## Validation
- config review
- CI dry run
