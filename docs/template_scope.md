# テンプレートのスコープ

## 含まれるもの

- 埋め込み Shopify アプリの最小ランタイム（OAuth / session / App Bridge / Polaris）
- Managed App Pricing 前提の課金シェル（`/app/pricing`, `/app/welcome`, refresh）
- HTTPS のみの webhook（uninstall / scopes_update / compliance）とインボックス
- Prisma（Session, Shop, WebhookInbox, Job, Artifact）とバックグラウンド worker（`webhook.shop-redact`, system retention / stuck-job sweep）
- Codex ハーネス: tickets, ADR 運用, architecture guardrails, contract tests, smoke 足場

## プラットフォーム前提

- **Scope truth:** granted scopes は `currentAppInstallation.accessScopes` query で取得する（詳細は [ADR-0002](../adr/0002-embedded-auth-and-token-exchange.md)）。
- **Webhook:** app-specific / HTTPS only。運用を単純化し、public app 審査と整合させるため（詳細は [ADR-0004](../adr/0004-app-specific-https-webhooks-only.md)）。
- **`/auth/login`:** ショップドメイン入力は開発・手動確認向けの補助経路。主経路は managed install / 埋め込み起動。

正本ファイルの一覧は [platform-truth-index.md](platform-truth-index.md) を参照。

## 意図的に含めないもの

- 商品バルク・プレビュー・エクスポート等のドメイン機能（旧 Product Domain Parity MVP は [adr/archive/product-domain/](adr/archive/product-domain/) に退避）

## 拡張するとき

- 新しいドメインは **ticket → plan → ADR** の順で追加する。
- `.agents/skills/domain-feature-stub/SKILL.md` を複製してドメイン用 skill を作る。
