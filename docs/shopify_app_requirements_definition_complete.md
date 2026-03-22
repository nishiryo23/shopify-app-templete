# Shopify アプリ要件定義（テンプレート）

本リポジトリは **ハーネス＋最小プラットフォーム** のテンプレートである。詳細要件は fork 先で ticket を起点に追記する。

## 参照

- [template_scope.md](template_scope.md) — このテンプレに含まれるもの / 含めないもの
- [platform-truth-index.md](platform-truth-index.md) — プラットフォーム統合の正本ファイル索引

## 主要 ADR

| ADR | 概要 |
| --- | --- |
| [0001-repo-truth-and-codex-harness](../adr/0001-repo-truth-and-codex-harness.md) | リポジトリの truth source と Codex ハーネス |
| [0002-embedded-auth-and-token-exchange](../adr/0002-embedded-auth-and-token-exchange.md) | 埋め込み認証と token exchange |
| [0003-managed-pricing-as-billing-source-of-truth](../adr/0003-managed-pricing-as-billing-source-of-truth.md) | Managed Pricing を billing truth に |
| [0004-app-specific-https-webhooks-only](../adr/0004-app-specific-https-webhooks-only.md) | app-specific / HTTPS only の webhook 方針 |
