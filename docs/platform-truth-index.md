---
doc_type: index
authority: documentation_index
truth_sources:
  - tests/fixtures/truth/platform-premises.md
  - tests/fixtures/truth/platform-premises.contracts.json
  - tests/contracts/platform-premises-doc-parity.contract.test.mjs
  - adr/0002-embedded-auth-and-token-exchange.md
  - adr/0003-managed-pricing-as-billing-source-of-truth.md
  - adr/0004-app-specific-https-webhooks-only.md
  - adr/0007-db-queue-artifact-and-provenance-crypto-truth.md
  - adr/0018-webhook-inbox-raw-payload-retention-boundary.md
---

# プラットフォーム統合の正本索引

エージェントが **Shopify プラットフォーム統合** の実装ファイルと ADR を辿るときの入口とする。ノルマティブな前提文は `tests/fixtures/truth/platform-premises.md` と本書の「プラットフォーム前提」節が一致し、`platform-premises-doc-parity` 契約テストで検証される。

## docs 内ファイル一覧

| ファイル | 説明 |
| --- | --- |
| app-review-metadata.md | App Store 提出用 review metadata の正本フィールド |
| codex-sdk-review-loop.md | Codex SDK による shopify review ループ実行メモ |
| codex_harness_bootstrap.md | Codex ハーネス導入と ticket 駆動のガイド |
| dev-store-smoke-checklist.md | dev store / reviewer 向け smoke チェックリスト |
| platform-truth-index.md | 本ファイル。プラットフォーム統合の索引と前提 |
| release-gate-matrix.md | 提出前・日常ゲートの matrix |
| reviewer-packet.md | reviewer と dev store dry-run 用パケット |
| shopify-review-promotions.md | infra / CI の review 向け不変条件メモ |
| shopify_app_requirements_definition_complete.md | テンプレ要件のエントリ（スコープ・参照） |
| shopify_app_technical_spec_complete.md | 技術仕様の短い要約と検証ゲート |
| shopify_local_development.md | Shopify CLI・トンネル URL・ローカル worker |
| template_scope.md | テンプレに含むもの／含めないもの |

新規 `docs/*.md` を追加するときは **フロントマター付与と本表の 1 行を同一コミット**で更新する。種別（`doc_type`）は各ファイルの YAML フロントマターを正とする。本表と `docs/*.md` の集合一致は `platform-premises-doc-parity` 契約で検証される。

## 認証・セッション・埋め込み

| ファイル | 役割 |
| --- | --- |
| `app/shopify.server.ts` | shopifyApp 初期化（appUrl, scopes, sessionStorage, webhooks） |
| `app/services/auth.server.ts` | login loader/action |
| `app/services/auth-bootstrap.server.ts` | セッション取得後の shop 初期化 |
| `app/services/session-crypto.server.ts` | offline token 暗号化 |
| `app/services/shop-session-storage.server.ts` | Prisma ベースの session storage |
| `app/routes/auth.login.tsx` | ショップドメイン入力（開発・手動確認向け補助経路） |
| `app/routes/auth.$.tsx` | OAuth 等の認証サブパス（catch-all。`runAuthLoader` に委譲） |

**関連 ADR:** [0002-embedded-auth-and-token-exchange](../adr/0002-embedded-auth-and-token-exchange.md)

## Webhook

| ファイル | 役割 |
| --- | --- |
| `shopify.app.toml` | app/uninstalled, app/scopes_update, compliance の subscription 定義 |
| `shopify.web.toml` | `webhooks_path` prefix（`/webhooks/app`） |
| `app/routes/webhooks.app.*.tsx` | lifecycle topic の route handler |
| `app/routes/webhooks.compliance.tsx` | compliance topic（customers/redact 等）の route handler |
| `domain/webhooks/prisma-inbox-store.mjs` | durable inbox への enqueue |
| `domain/webhooks/compliance-jobs.mjs` | shop-redact ジョブ定義 |
| `domain/webhooks/compliance.server.mjs` | shop-redact の実行ロジック |

**関連 ADR:** [0004-app-specific-https-webhooks-only](../adr/0004-app-specific-https-webhooks-only.md), [0018-webhook-inbox-raw-payload-retention-boundary](../adr/0018-webhook-inbox-raw-payload-retention-boundary.md)

## Billing / 課金

| ファイル | 役割 |
| --- | --- |
| `app/services/billing.server.ts` | billing 関連 helper |
| `app/routes/app.pricing.tsx` | pricing page |
| `app/routes/app.welcome.tsx` | welcome / entitlement refresh |
| `domain/billing/entitlement-state.mjs` | subscription status → entitlement mapping |
| `domain/billing/current-installation.mjs` | currentAppInstallation query |

**関連 ADR:** [0003-managed-pricing-as-billing-source-of-truth](../adr/0003-managed-pricing-as-billing-source-of-truth.md)

## Worker / ジョブキュー

| ファイル | 役割 |
| --- | --- |
| `workers/bootstrap.mjs` | worker entry（lease, dispatch, heartbeat, shutdown） |
| `workers/webhook-compliance.mjs` | shop-redact job runner |
| `workers/system-sweeps.mjs` | retention / stuck-job sweep runner |
| `domain/jobs/prisma-job-queue.mjs` | Prisma ベースの job queue |
| `domain/system-jobs.mjs` | システムジョブ定義（sweep 等） |
| `prisma/schema.prisma` | Job, Artifact モデル |

**関連 ADR:** [0007-db-queue-artifact-and-provenance-crypto-truth](../adr/0007-db-queue-artifact-and-provenance-crypto-truth.md)

## Retention / コンプライアンスジョブ

| ファイル | 役割 |
| --- | --- |
| `domain/retention/policy.mjs` | artifact 保持期間ポリシー |
| `domain/artifacts/retention.mjs` | artifact 削除ロジック |
| `domain/artifacts/prisma-artifact-catalog.mjs` | artifact catalog（Prisma） |

**関連 ADR:** [0007-db-queue-artifact-and-provenance-crypto-truth](../adr/0007-db-queue-artifact-and-provenance-crypto-truth.md)

## プラットフォーム前提（テンプレ利用者向け）

- **Scope truth:** granted scopes は `currentAppInstallation.accessScopes` query で取得する。webhook payload を truth にしない（詳細は ADR-0002）。
- **Webhook:** app-specific / HTTPS only。運用を単純化し、public app 審査と整合させるため（詳細は ADR-0004）。
- **`/auth/login`:** ショップドメイン入力は開発・手動確認向けの補助経路。本番利用の主経路は **managed install** または **Admin からの埋め込み起動**（ADR-0002 と整合）。

詳細は各 ADR を参照。
