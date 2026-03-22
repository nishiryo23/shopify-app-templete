# プラットフォーム統合の正本索引

このテンプレートで **Shopify プラットフォーム統合** を担う主要ファイルと ADR の一覧。新機能を追加するときの起点として参照する。

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

- **Scope truth:** granted scopes は `currentAppInstallation.accessScopes` query で取得する（webhook payload を truth にしない）。
- **Webhook:** app-specific / HTTPS only。運用を単純化し、public app 審査と整合させるため。
- **`/auth/login`:** ショップドメイン入力は開発・手動確認向けの補助経路。本番利用の主経路は **managed install** または **Admin からの埋め込み起動**。

詳細は各 ADR を参照。
