# AWS infra bootstrap

`P-006` の正本。launch 用の AWS resource と wiring をここに固定する。

## Existing resources assumed
- ECS cluster
- ECS service: `web`
- ECS service: `worker`

この ticket の workflow は service の作成を行わず、task definition の登録と service update のみを行う。

## Required resources
- ECR repository
- ECS cluster
- ECS service: `web`
- ECS service: `worker`
- ECS one-off task execution for `migrate`
- Task execution role
- Task role
- RDS PostgreSQL
- Private S3 bucket
- KMS key
- Secrets Manager
- ALB
- CloudWatch Logs

## Out of scope
- Full IaC
- Route 53 cutover
- EventBridge Scheduler wiring
- Service creation
- Production cutover

## Runtime contract
### Plain config
- `NODE_ENV`
- `PORT` (`web` のみ)
- `SHOPIFY_API_KEY`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `AWS_REGION`
- `S3_ARTIFACT_BUCKET`
- `S3_ARTIFACT_PREFIX`
- `LOG_LEVEL`
- `QUEUE_POLL_INTERVAL_MS`
- `QUEUE_LEASE_MS`

### Secrets
- `DATABASE_URL`
- `SHOPIFY_API_SECRET`
- `SHOP_TOKEN_ENCRYPTION_KEY`
- `PROVENANCE_SIGNING_KEY`

secret は ECS task definition の `secrets.valueFrom` で注入する。GitHub Actions は secret 値を扱わず、ARN または名前だけを input として渡す。

## Networking
- `web` / `worker` / `migrate` は RDS に到達できる private subnet と task security group を共有する
- ALB target group は `web` のみを監視する
- health check path は `/health`
- `/health` は unauthenticated `200 OK` を返す liveness endpoint とし、DB readiness は扱わない

## Storage and crypto
- artifact truth は `private S3 + SSE-KMS`
- public bucket と public URL は前提にしない
- `SHOP_TOKEN_ENCRYPTION_KEY` と `PROVENANCE_SIGNING_KEY` は別 secret にする

## Deploy order
1. Docker image build
2. ECR push
3. task definition render
4. `migrate` one-off task run
5. `web` service update
6. `worker` service update

## Workflow inputs
- `aws_region`
- `ecr_repository`
- `ecs_cluster`
- `web_service`
- `worker_service`
- `web_task_family`
- `worker_task_family`
- `migrate_task_family`
- `task_execution_role_arn`
- `task_role_arn`
- `artifact_bucket`
- `private_subnet_ids`
- `task_security_group_ids`
- `database_url_secret_arn`
- `shopify_api_secret_arn`
- `shop_token_encryption_key_secret_arn`
- `provenance_signing_key_secret_arn`

`private_subnet_ids` と `task_security_group_ids` は comma-separated string として workflow に渡す。

## Future work
- EventBridge Scheduler resource と target wiring
- Service provisioning IaC
- Route 53 / DNS cutover
- S3 adapter の本格実装
