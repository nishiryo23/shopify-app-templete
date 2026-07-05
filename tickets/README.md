# Tickets

## Operating rules

- **1 session = 1 ticket**
- complete harness tickets first
- create `plans/<ticket-id>.md` before implementation
- create or update an ADR when the ticket changes architecture or source-of-truth
- after implementation, run the ticket validation and record the ADR number used
- ticket を完了したら本ファイルの status を `done` に更新する

## Execution order

### Phase H: Harness first

| # | Ticket | Status |
| --- | --- | --- |
| 1 | `tickets/harness/H-001-harness-bootstrap.md` | done |
| 2 | `tickets/harness/H-002-quality-gates-and-architecture-guardrails.md` | done |
| 3 | `tickets/harness/H-003-contract-tests-for-billing-webhook-provenance.md` | done |
| 4 | `tickets/harness/H-004-playwright-and-dev-store-smoke-scaffolding.md` | done |

### Phase P: Platform foundation

| # | Ticket | Status |
| --- | --- | --- |
| 5 | `tickets/platform/P-001-embedded-shell-and-session-auth.md` | done |
| 6 | `tickets/platform/P-002-shop-bootstrap-offline-token-scope-truth.md` | done |
| 7 | `tickets/platform/P-003-entitlement-refresh-pricing-gate-and-state-mapping.md` | done |
| 8 | `tickets/platform/P-004-webhooks-uninstall-redact-lifecycle.md` | done |
| 9 | `tickets/platform/P-005-db-queue-artifact-crypto-foundation.md` | done |
| 10 | `tickets/platform/P-006-aws-infra-bootstrap.md` | done |

### Phase O: Operability and launch

| # | Ticket | Status |
| --- | --- | --- |
| 11 | `tickets/operability/O-001-observability-telemetry-retention-sweeps.md` | done |
| 12 | `tickets/operability/O-002-app-review-readiness-and-release-gate.md` | done |

### 追加 harness / platform tickets

| # | Ticket | Status |
| --- | --- | --- |
| 13 | `tickets/harness/H-016-admin-ui-quality-harness.md` | done |
| 14 | `tickets/platform/P-007-managed-pricing-plan-selection-deeplink.md` | done |
| 15 | `tickets/platform/P-008-minimal-empty-access-scopes.md` | done |
| 16 | `tickets/harness/H-017-ci-gate-and-config-sync.md` | done |
| 17 | `tickets/platform/P-009-growth-kit.md` | done（ADR-0026。テンプレ本体に Growth Kit v1 を実装） |
| 18 | `tickets/platform/P-010-partner-api-billing-truth.md` | done（ADR-0027。Partner API `activeSubscription` + DB snapshot TTL resolver へ billing truth を移行） |

### Phase F: Template initialization（fork 導線）

F-001 は **fork したリポジトリで実行**する。F-002 は **テンプレ本体で** fork 導線をスクリプト化する（実装は P-009 と独立、どちらを先に着手してもよい）。
F-002 完了後、fork 初期化の反復作業は production `shopify app config link` 後の `node scripts/init-new-app.mjs --confirm-fork` を正本にし、F-001 は script が扱わない Partner Dashboard / scope 判断 / smoke 確認の checklist として参照する。

| # | Ticket | Status |
| --- | --- | --- |
| F | `tickets/template/F-001-fork-initialization.md` | pending（fork したリポジトリで実行する。反復作業は F-002 script を参照） |
| F | `tickets/template/F-002-fork-init-script.md` | done（ADR-0025。fork 初期化 script を追加） |

## ドメイン機能

商品バルク等の旧 ticket は `adr/archive/product-domain/` に対応する ADR とともにアーカイブ済み。新規ドメインは `.agents/skills/domain-feature-stub/SKILL.md` を複製してから ticket を追加する。UI を伴う場合は `.agents/skills/polaris-admin-ui/SKILL.md` の acceptance criteria に従う。
