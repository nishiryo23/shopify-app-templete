# ADR-0006 AWS as launch infrastructure

- Status: Accepted

## Context
launch scope は web + worker + object storage + DB queue + secrets + observability を必要とする。

## Decision
- AWS ECS Fargate (web / worker)
- RDS PostgreSQL
- S3
- Secrets Manager
- KMS
- CloudWatch
- GitHub Actions

## Consequences
serverless 単機能構成より job orchestration と artifact retention を扱いやすい。
