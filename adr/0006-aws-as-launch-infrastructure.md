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
- Prisma session storage も RDS PostgreSQL を truth とし、node-local SQLite は本番構成に使わない
- background job orchestration は PostgreSQL-backed queue を app truth とし、Shopify bulk mutation の並列上限とは別に app 側で shop 単位 single-writer を維持する
- artifact metadata は PostgreSQL、artifact 本体は private S3 object storage を truth とし、公開バケットや永続 public URL を前提にしない
- offline token 暗号鍵と provenance signing key は分離し、Secrets Manager / KMS で別 secret として扱う

## Consequences
serverless 単機能構成より job orchestration と artifact retention を扱いやすい。
