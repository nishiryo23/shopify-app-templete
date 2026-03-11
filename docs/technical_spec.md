# Shopify公開アプリ 仕様書（完全版）
**文書名**: Shopify公開アプリ 仕様書（完全版）  
**対象**: Public / Embedded Shopify App（Product GA）  
**版**: 1.0  
**状態**: Fixed  
**前提**: Collection workflow は limited beta。launch GA の技術クリティカルパスから外す。

---

## 1. 文書の位置づけ

本書は、要件定義書を受けて **技術的な外部契約・状態遷移・統合方式・運用方式** を固定する仕様書である。  
本書は **Shopify公式準拠を外さない technical specification** と **実装 appendix** を統合した完全版であり、  
route contract / webhook contract / state machine / runbook / test matrix を含む。

---

## 2. 固定された前提

## 2.1 プロダクト前提
- launch GA は **Product workflow only**
- Collection workflow は **limited beta**
- update 対象は product-level fields のみ
- write success truth は **final-state verification**

## 2.2 Platform 前提
- public app
- embedded app
- Shopify managed install
- App Bridge
- Polaris UI
- session token + token exchange
- GraphQL Admin API only
- Managed App Pricing
- app-specific webhooks only
- HTTPS webhooks only
- API version `2026-01`

## 2.3 明示的に却下する設計
- legacy install flow を primary にする
- cookie-only auth
- frontend からの direct Admin API access
- REST Admin API
- off-platform billing
- shop-specific webhooks（v1）
- compliance topic の Admin API 登録
- Product GA に Collection GA を混ぜる

---

## 3. 採用スタック

## 3.1 固定する実装スタック
- Runtime: Node.js LTS + TypeScript
- App framework: React Router 7
- Shopify package: `@shopify/shopify-app-react-router`
- UI: Polaris Web Components + App Bridge
- ORM: Prisma
- Database: PostgreSQL
- Session storage: Prisma session storage
- Queue: PostgreSQL-backed queue
- Worker: 別 process
- Artifact storage: private S3-compatible object storage
- CI/CD: GitHub Actions
- Secrets: cloud secret manager

## 3.2 採用理由
- Shopify 公式テンプレート流儀に最大限寄せるため
- public embedded app の review-safe な実装にしやすいため
- session token / App Bridge / Prisma session storage / Polaris の整合が取れるため

---

## 4. System context

```text
Merchant Browser (Shopify Admin Embedded)
  -> App Bridge + Polaris UI
  -> App Web (React Router)
     -> Shopify Auth / Token Exchange
     -> PostgreSQL (app state, queue, sessions)
     -> Object Storage (artifacts)
     -> Shopify Admin GraphQL API
     -> Worker Process (async jobs)
     -> Webhook Ingress (HTTPS)
```

---

## 5. App config specification

## 5.1 `shopify.app.toml`
以下を固定する。

- `embedded = true`
- `access_scopes.scopes = "read_products,write_products"`
- optional scopes なし
- `use_legacy_install_flow` omitted / false
- `embedded_app_direct_api_access` omitted / false
- `[webhooks] api_version = "2026-01"`
- fixed webhook subscriptions 定義済み
- public app 用 redirect URLs あり

## 5.2 fixed webhook topics
- `app/uninstalled`
- `app_subscriptions/update`
- `customers/data_request`
- `customers/redact`
- `shop/redact`

## 5.3 deploy rule
- code deploy が先
- `shopify app deploy` が後
- TOML 変更時のみ production deploy を行う

---

## 6. Authentication and authorization specification

## 6.1 authN / authZ の責務分割
- **session token**: frontend→backend の request authentication
- **online token**: request-scoped の user-context Admin API access
- **offline token**: background worker の Admin API access

## 6.2 session token contract
- 全 authenticated XHR/fetch は bearer session token 必須
- backend は session token 検証前に business logic を開始しない
- invalid session:
  - document request → bounce
  - XHR/fetch → `401 + X-Shopify-Retry-Invalid-Session-Request`

## 6.3 token exchange contract
- online token は request-scoped only
- cross-request online token cache は禁止
- offline token は non-expiring token を保存
- reinstall 後は offline token を再取得する

## 6.4 owner-only action contract
以下は owner-only とする。
- product import confirm
- product undo

判定 truth:
- online token exchange response の `associated_user.account_owner`

---

## 7. Install / reinstall specification

## 7.1 install truth
install の truth は **first authenticated bootstrap success** とする。

## 7.2 install flow
1. merchant installs from Shopify-owned surface
2. Shopify handles scopes
3. app opens embedded route
4. app performs authenticated bootstrap
5. app upserts shop row
6. app obtains offline token if missing
7. app refreshes entitlement
8. app shows `/app` or `/app/pricing`

## 7.3 reinstall flow
1. reinstall occurs
2. same bootstrap runs again
3. local stale state is ignored
4. entitlement is rebuilt from Shopify query
5. app resumes only after lifecycle state is valid

## 7.4 rejection rules
- bootstrap failure → app shell may render loading/failure state only
- no business action before auth success

---

## 8. Billing and entitlement specification

## 8.1 default billing option
- Managed App Pricing only

## 8.2 truth source
- paid entitlement truth: `currentAppInstallation.activeSubscriptions`
- billing history / transition metadata: `currentAppInstallation.allSubscriptions`
- welcome link / webhook: reconciliation trigger only

## 8.3 local billing states
- `UNENTITLED`
- `PENDING_APPROVAL`
- `ACTIVE_FREE`
- `ACTIVE_PAID`
- `PAYMENT_HOLD`
- `INACTIVE`

## 8.4 Shopify status mapping
- `PENDING` → `PENDING_APPROVAL`
- `ACTIVE` → `ACTIVE_PAID`
- `FROZEN` → `PAYMENT_HOLD`
- `DECLINED` / `EXPIRED` / `CANCELLED` → entitlement not granted
- active paid subscription なし + free tier available → `ACTIVE_FREE`
- shop lifecycle が ACTIVE でない → `INACTIVE`

## 8.5 gating rules
- `ACTIVE_PAID`: paid features enabled
- `ACTIVE_FREE`: free features only
- `PENDING_APPROVAL`: write disabled
- `PAYMENT_HOLD`: read-only
- `UNENTITLED` / `INACTIVE`: pricing or blocked state only

## 8.6 currentPeriodEnd の扱い
- `currentPeriodEnd` は `ACTIVE_PAID` の advisory metadata としてのみ保持
- entitlement 判定は active subscription の有無を優先
- future downgrade は `next_plan_change` metadata として管理してよいが、権限 truth にはしない

## 8.7 hosted pricing URL
```text
https://admin.shopify.com/store/{storeHandle}/charges/{appHandle}/pricing_plans
```

## 8.8 welcome link contract
- welcome link 到達だけでは paid にしない
- `/app/welcome` で必ず entitlement refresh を実行する

---

## 9. Scope specification

## 9.1 required scopes
- `read_products`
- `write_products`

## 9.2 optional scopes
- none

## 9.3 scope truth
- `currentAppInstallation.accessScopes`

## 9.4 scope mismatch handling
- bootstrap / refresh 時に expected scopes と比較
- missing scope なら degraded mode
- write UI と write API を閉じる

---

## 10. Route contract

## 10.1 共通ルール
- document routes: embedded shell only
- JSON API routes: session token required
- webhook routes: raw body + HMAC only
- internal worker routes: public 非公開

**JSON response envelope**
```json
{
  "ok": true,
  "data": {},
  "request_id": "..."
}
```
```json
{
  "ok": false,
  "code": "...",
  "message": "...",
  "retryable": false,
  "request_id": "..."
}
```

**HTTP status rules**
- `401`: invalid session
- `403`: owner-only / entitlement denied
- `409`: concurrent write / preview changed / invalid lifecycle
- `410`: artifact expired or deleted
- `422`: semantic validation error
- `202`: accepted async job creation

---

## 10.2 Document routes

### `GET /app`
**Purpose**
- primary embedded shell

**Behavior**
- bootstrap state 表示
- authenticated and entitled なら app home
- unentitled なら pricing CTA
- side effects なし

### `GET /app/pricing`
**Purpose**
- pricing state view and CTA

**Behavior**
- current entitlement state を表示
- hosted pricing page CTA を表示

### `GET /app/welcome`
**Purpose**
- Managed Pricing welcome link landing

**Behavior**
- `charge_id` があっても entitlement を直接付与しない
- `currentAppInstallation` を query
- `/app` or `/app/pricing` へ遷移

---

## 10.3 JSON API routes

### `GET /api/context`
**Purpose**
- UI bootstrap context

**Returns**
- shop lifecycle state
- granted scopes
- entitlement state
- owner capability
- feature flags
- API version stamp

### `POST /api/entitlement/refresh`
**Purpose**
- billing / scope / lifecycle resync

**Behavior**
- `currentAppInstallation` を query
- local entitlement / granted scopes を更新
- updated state を返す

### `POST /api/product-exports`
**Purpose**
- product export job creation

**Input**
- filter payload

**Response**
- `202`, `job_id`

### `POST /api/product-imports`
**Purpose**
- CSV upload + preview job creation

**Input**
- multipart upload
- product CSV only

**Response**
- `202`, `job_id`

### `GET /api/product-imports/{jobId}`
**Purpose**
- preview / result / job detail retrieval

### `POST /api/product-imports/{jobId}/confirm`
**Purpose**
- owner confirmation of write job

**Input**
- `preview_id`
- `preview_hash`

**Rules**
- owner only
- preview TTL check
- revalidation
- snapshot required
- concurrent write denied

### `POST /api/product-imports/{jobId}/undo`
**Purpose**
- owner confirmation of latest-job undo

### `GET /api/jobs/{jobId}/artifacts/{kind}`
**Allowed `kind`**
- `source`
- `preview`
- `result`
- `error`

**Rules**
- shop ownership required
- deleted/expired artifact returns `410 Gone`

---

## 11. Webhook contract

## 11.1 delivery method
- HTTPS only

## 11.2 endpoints
- `POST /webhooks/app/uninstalled`
- `POST /webhooks/app_subscriptions/update`
- `POST /webhooks/customers/data_request`
- `POST /webhooks/customers/redact`
- `POST /webhooks/shop/redact`

## 11.3 common invariants
- raw body unchanged until HMAC verification
- invalid HMAC → `401`, no side effects
- dedupe key = `shop + topic + X-Shopify-Event-Id`
- dedupe retention = 30 days
- duplicate = `200`, no-op
- new event = durable inbox write + enqueue before `200`
- enqueue failure = non-2xx
- handlers do not perform long-running business work inline

## 11.4 topic-specific behavior

### `app/uninstalled`
- `shop.status = UNINSTALLED`
- delete offline token
- cancel queued/running write jobs
- deny new writes
- schedule 30-day tombstone retention

### `app_subscriptions/update`
- enqueue entitlement refresh only
- do not mutate entitlement from payload directly

### `customers/data_request`
- audit no-op
- return `200`

### `customers/redact`
- audit no-op
- return `200`

### `shop/redact`
- set `REDACTION_PENDING`
- enqueue hard delete
- deny read/write
- terminal state after delete: `REDACTED`

---

## 12. Product CSV contract

## 12.1 export header
```text
_schema_version,_resource_type,_shop_domain,_export_job_id,_exported_at,_row_fingerprint,商品ID,参照ハンドル,商品名,ステータス,販売元,商品タイプ,タグ
```

## 12.2 allowed edits
Allowed:
- editable business column value changes
- column reordering
- row deletion

Forbidden:
- row addition
- unknown columns
- editing provenance/metadata columns

## 12.3 semantics
- primary key: 商品ID only
- blank = no change
- `__CLEAR__` allowed only for vendor / productType / tags
- `status` accepts canonical enum only
- `tags` = replace-all only

## 12.4 TTL
- manifest TTL: 7 days
- preview TTL: 30 minutes

---

## 13. Product workflow specification

## 13.1 export
1. create export job
2. fetch products by filter
3. normalize rows
4. generate manifest + row fingerprints
5. save source artifact
6. persist export manifest

## 13.2 preview
1. upload file
2. save raw upload artifact
3. verify manifest + fingerprints
4. parse and normalize CSV
5. fetch live Shopify state
6. compute row diff / warning / error
7. save row-level preview model
8. save preview artifact
9. move job to `PREVIEW_READY`

## 13.3 confirm
1. owner auth check
2. preview TTL check
3. preview hash revalidation
4. concurrent write guard
5. snapshot creation
6. enqueue write

## 13.4 write
1. create staged upload payload
2. run `bulkOperationRunMutation`
3. poll operation state
4. on terminal completion, move to `VERIFYING`

## 13.5 final-state verification
1. read touched product IDs from Shopify
2. compare actual state to target state
3. decide row-level result
4. generate result / error artifact
5. move job to `SUCCESS` / `PARTIAL_SUCCESS` / `FAILED`

## 13.6 undo
1. latest successful write eligibility check
2. conflict detection
3. create undo target payload
4. write
5. final-state verification
6. move to `UNDONE` / `UNDO_PARTIAL` / `FAILED`

---

## 14. Lifecycle state machine

## 14.1 Shop lifecycle
```text
NEVER_INSTALLED
  -> INSTALLED_UNBOOTSTRAPPED
INSTALLED_UNBOOTSTRAPPED
  -> ACTIVE
ACTIVE
  -> UNINSTALLED
UNINSTALLED
  -> ACTIVE
ACTIVE
  -> REDACTION_PENDING
UNINSTALLED
  -> REDACTION_PENDING
REDACTION_PENDING
  -> REDACTED
REDACTED
  -> ACTIVE (fresh reinstall only)
```

## 14.2 Entitlement lifecycle
```text
UNKNOWN
  -> ACTIVE_FREE
  -> PENDING_APPROVAL
  -> ACTIVE_PAID
  -> PAYMENT_HOLD
  -> UNENTITLED

ACTIVE_PAID
  -> PAYMENT_HOLD
  -> ACTIVE_FREE
  -> UNENTITLED

PENDING_APPROVAL
  -> ACTIVE_PAID
  -> ACTIVE_FREE / UNENTITLED

PAYMENT_HOLD
  -> ACTIVE_PAID
  -> ACTIVE_FREE / UNENTITLED

ANY
  -> INACTIVE when shop lifecycle != ACTIVE
```

## 14.3 Product import lifecycle
```text
DRAFT
  -> PREVIEW_READY
  -> FAILED

PREVIEW_READY
  -> PREVIEW_EXPIRED
  -> REVALIDATION_REQUIRED
  -> QUEUED

QUEUED
  -> RUNNING
RUNNING
  -> VERIFYING
  -> FAILED

VERIFYING
  -> SUCCESS
  -> PARTIAL_SUCCESS
  -> FAILED

SUCCESS / PARTIAL_SUCCESS
  -> UNDO_QUEUED
UNDO_QUEUED
  -> UNDO_RUNNING
UNDO_RUNNING
  -> UNDONE / UNDO_PARTIAL / FAILED
```

## 14.4 Webhook inbox lifecycle
```text
RECEIVED
  -> REJECTED_INVALID_HMAC
  -> DUPLICATE
  -> ENQUEUED

ENQUEUED
  -> PROCESSING
PROCESSING
  -> DONE
  -> RETRYABLE_FAILURE
  -> DEAD_LETTER
```

---

## 15. Data model specification

## 15.1 Core models
- `Session`
- `Shop`
- `EntitlementSnapshot`
- `ExportManifest`
- `ImportJob`
- `ImportJobRow`
- `Snapshot`
- `Artifact`
- `WebhookInbox`
- `QueueJob`
- `JobAttempt`
- `AuditEvent`

## 15.2 Required constraints
- `Shop.shopDomain` unique
- `WebhookInbox(shopDomain, topic, eventId)` unique
- one active write job per shop
- `Artifact(jobId, kind)` unique
- foreign keys from jobs/artifacts/snapshots to shop

## 15.3 encrypted fields
- `Shop.offlineTokenEnc`
- optional secret-bearing metadata fields

---

## 16. Queue and worker specification

## 16.1 queue policy
- PostgreSQL-backed queue
- worker is separate process
- leasing via DB row locking
- retry with bounded backoff
- terminal failure goes to DLQ
- one app-owned write per shop

## 16.2 job types
- `ENTITLEMENT_REFRESH`
- `PRODUCT_EXPORT`
- `PRODUCT_PREVIEW`
- `PRODUCT_CONFIRM`
- `PRODUCT_WRITE`
- `PRODUCT_VERIFY`
- `PRODUCT_UNDO`
- `UNINSTALL_CLEANUP`
- `SHOP_REDACT`
- `RETENTION_SWEEP`
- `STUCK_JOB_SWEEP`

## 16.3 retry/backoff
Recommended default:
- 30s
- 5m
- 30m
- 2h
- then DLQ

## 16.4 reconciliation cadence
- stuck job sweep: every 15 minutes
- entitlement reconciliation: hourly
- uninstall cleanup sweep: hourly
- retention sweep: daily

---

## 17. Artifact storage specification

## 17.1 storage policy
- private S3-compatible object storage
- no direct public bucket URL exposure
- app-authenticated download route only

## 17.2 object keys
```text
{env}/{shopDomain}/{jobId}/source.csv
{env}/{shopDomain}/{jobId}/preview.json.gz
{env}/{shopDomain}/{jobId}/result.csv
{env}/{shopDomain}/{jobId}/error.csv
{env}/{shopDomain}/{jobId}/snapshot.json.gz
```

## 17.3 retention
- 30 days lifecycle
- immediate deletion on `shop/redact`
- `410 Gone` after expiry/deletion

---

## 18. Crypto and key management

## 18.1 key classes
- Shopify app secret
- DB secret
- object storage secret
- provenance signing key ring
- field encryption master key
- telemetry pseudonym salt

## 18.2 row fingerprint
- HMAC-based
- current signing key + previous keys accepted
- previous key retention: 14 days

## 18.3 offline token encryption
- envelope encryption required
- plaintext persistence forbidden

## 18.4 telemetry pseudonym
- irreversible HMAC(shopDomain, telemetrySalt)
- telemetrySalt isolated from signing keys

---

## 19. Privacy / retention / redact specification

## 19.1 retained data zones
### Redactable telemetry zone
- retention: 0–7 days
- may contain shop-identifiable fields
- deleted on `shop/redact`

### Pseudonymous telemetry zone
- retention: 8–90 days
- no shop-identifiable fields
- only irreversible pseudonym or aggregate

## 19.2 hard delete target on `shop/redact`
- shop row
- tokens
- artifacts
- snapshots
- dedupe keys
- uninstall tombstone
- redactable telemetry
- any shop-identifiable audit payload

## 19.3 data not collected in v1
- customers
- orders
- emails
- phones
- addresses
- raw CSV contents in analytics
- raw webhook body retention

---

## 20. Observability specification

## 20.1 required structured fields
- `request_id`
- `shop` or pseudonymous equivalent per telemetry zone
- `job_id`
- `webhook_event_id`
- `topic`
- `api_version_requested`
- `api_version_returned`
- `outcome`
- `latency_ms`

## 20.2 required metrics
- bootstrap success rate
- invalid session retry rate
- token exchange failures
- webhook HMAC failure rate
- webhook 2xx rate
- webhook p95 latency
- queue lag
- bulk job stuck count
- entitlement mismatch count
- uninstall cleanup lag

## 20.3 alert conditions
- token exchange 400 spike
- invalid session retry spike
- webhook 2xx drop
- queue lag threshold exceeded
- bulk job stuck threshold exceeded
- API version mismatch

---

## 21. Runbook

## 21.1 Install/bootstrap failure
**Trigger**
- install completes but app stays loading

**Action**
- verify App Bridge load
- verify redirect URLs
- verify session token validation
- verify token exchange
- rollback broken deploy if needed

## 21.2 Invalid session spike
**Trigger**
- 401/retry spike or bounce loop

**Action**
- inspect token audience/destination
- inspect clock skew
- confirm direct API access is disabled
- confirm only one retry occurs

## 21.3 Webhook backlog/HMAC failure
**Trigger**
- webhook 2xx drop or HMAC failure spike

**Action**
- check raw body invariant
- check app secret mismatch
- check queue durability
- drain backlog after fix

## 21.4 Billing drift / payment hold
**Trigger**
- merchant says paid but app denies access
- payment hold complaints

**Action**
- manually query `currentAppInstallation`
- refresh local entitlement snapshot
- map `FROZEN` to `PAYMENT_HOLD`
- never force paid from webhook alone

## 21.5 Uninstall / redact
**Trigger**
- uninstall or redact event received

**Action**
- stop writes immediately
- delete/revoke tokens
- enqueue cleanup/delete
- verify hard delete completion

## 21.6 API version drift
**Trigger**
- returned API version mismatch
- quarterly review due

**Action**
- identify offending client path
- update pinned version
- evaluate enum/schema deltas
- schedule safe upgrade

---

## 22. Test matrix

## 22.1 Install / lifecycle
- fresh install succeeds
- reinstall succeeds
- manual shop input absent
- uninstall stops writes
- redact hard-deletes within SLA

## 22.2 Embedded auth
- every API request carries bearer session token
- invalid XHR -> `401 + retry header`
- invalid document -> bounce
- direct API access disabled
- online token request-scoped only

## 22.3 Billing
- pricing page redirect works
- welcome link does not grant entitlement by itself
- query grants `ACTIVE_PAID`
- `FROZEN` maps to `PAYMENT_HOLD`
- terminal statuses deny paid access

## 22.4 Webhooks
- valid HMAC pass
- invalid HMAC fail
- duplicate no-op
- enqueue failure causes non-2xx
- all fixed topics route correctly

## 22.5 Product workflow
- export creates signed manifest CSV
- tampered import rejected
- preview does not write
- owner-only confirm enforced
- revalidation drift blocks write
- snapshot failure blocks write
- final-state verification decides success
- partial success generates artifacts
- latest-job undo works
- conflict rows are skipped

## 22.6 Review readiness
- support email configured
- submission contact email configured
- privacy policy URL configured
- merchant-facing routes fatal-free
- reviewer packet ready

---

## 23. App Review readiness checklist

- dev store install tested
- uninstall/reinstall tested
- managed pricing tested
- embedded shell tested
- invalid session behavior tested
- compliance webhook delivery tested
- support email configured
- submission contact email configured
- `app-audits@shopify.com` / `noreply@shopify.com` receivable
- privacy policy URL listed
- collection beta hidden from reviewer stores or clearly excluded

---

## 24. Implementation appendix

## 24.1 Repository structure
```text
/app
  /routes
  /services
  /db
  /workers
  /lib
```

## 24.2 `shopify.server.ts`
- initializes `shopifyApp(...)`
- pins Admin API version `2026-01`
- uses Prisma session storage
- exports `authenticate`
- does not register shop-specific webhooks
- does not use Billing API recurring charges
- does not enable direct API access

## 24.3 Key services
- `auth.server.ts`
- `billing.server.ts`
- `products.server.ts`
- `jobs.server.ts`
- `artifacts.server.ts`
- `webhooks.server.ts`
- `telemetry.server.ts`
- `retention.server.ts`
- `signing.server.ts`

## 24.4 CI/CD
- PR: lint, typecheck, tests, schema validate, build
- preview env: smoke tests
- prod deploy:
  1. build
  2. migrate
  3. deploy web
  4. deploy worker
  5. smoke
  6. conditional `shopify app deploy`
  7. release tag

---

## 25. 既知の限定事項

- Collection workflow は beta のまま
- owner-only confirm は UX friction を生む可能性がある
- v1 は optional scopes を使わない
- v1 は direct API access を使わない
- v1 は queue を Postgres に載せるため、超大規模運用では later で再評価余地がある

---

## 26. 完了判定

本仕様書に対する実装完了は、以下を満たしたときにのみ成立する。

1. route contract が一致する
2. webhook contract が一致する
3. state machine が一致する
4. runbook が存在する
5. test matrix がすべて pass する
6. App Review checklist がすべて埋まる
