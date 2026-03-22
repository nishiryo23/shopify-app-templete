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
- CloudWatch Metrics / Alarms

`infra/aws/observability-contract.json` を observability / retention / scheduler cadence の repo 正本とする。

## Out of scope
- Full IaC
- Route 53 cutover
- EventBridge Scheduler resource provisioning
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
- `TELEMETRY_PSEUDONYM_KEY` (`web` / `worker` のみ)

secret は ECS task definition の `secrets.valueFrom` で注入する。GitHub Actions は secret 値を扱わず、ARN または名前だけを input として渡す。

## Networking
- `web` / `worker` / `migrate` は RDS に到達できる private subnet と task security group を共有する
- ALB target group は `web` のみを監視する
- health check path は `/health`
- `/health` は unauthenticated `200 OK` を返す liveness endpoint とし、DB readiness は扱わない

## Storage and crypto
- artifact truth は `private S3 + SSE-KMS`
- public bucket と public URL は前提にしない
- ドメインで manifest 署名などを追加する場合は `PROVENANCE_SIGNING_KEY` を別 secret として足す（テンプレ既定の ECS 定義には含めない）
- `TELEMETRY_PSEUDONYM_KEY` は `web` / `worker` のみ必須とし、`migrate` task には注入しない

## Observability contract
- CloudWatch Logs retention は 7 日
- EMF namespace は `ShopifyAppTemplate/Operations`（fork 時にアプリ名へ差し替え）
- alarm / scheduler cadence / retention policy は `infra/aws/observability-contract.json` に固定する
- webhook raw payload / HMAC は ingress から最大 7 日で redact し、未処理 residue には metadata だけを残す
- retention sweep は `Asia/Tokyo` 03:00 に日次実行、stuck-job sweep は 5 分ごとに実行する
- EventBridge Scheduler resource をまだ provision していない環境では、起動中の `worker` が同 cadence で system sweep job を自己 enqueue する
- self-enqueued system sweep job は shop backlog より先に lease し、dead-letter しても cooldown 後に同一 window を再試行する

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
- `telemetry_pseudonym_key_secret_arn`

`private_subnet_ids` と `task_security_group_ids` は comma-separated string として workflow に渡す。

## Future work
- EventBridge Scheduler resource と target wiring
- CloudWatch Alarm resource provisioning
- Service provisioning IaC
- Route 53 / DNS cutover
- S3 adapter の本格実装
