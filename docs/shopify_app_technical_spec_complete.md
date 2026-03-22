# Shopify アプリ技術仕様（テンプレート要約）

本ファイルは **App Store 審査・運用で参照される repo 内リンク** を維持するための短い正本である。詳細なドメイン仕様はテンプレに含めない。スコープは [template_scope.md](template_scope.md)。

## 正本索引

- [platform-truth-index.md](platform-truth-index.md) — 認証・webhook・billing・worker・retention の主要ファイルと ADR リンク

## 主要 ADR

| ADR | 概要 |
| --- | --- |
| [0001-repo-truth-and-codex-harness](../adr/0001-repo-truth-and-codex-harness.md) | リポジトリの truth source と Codex ハーネス |
| [0002-embedded-auth-and-token-exchange](../adr/0002-embedded-auth-and-token-exchange.md) | 埋め込み認証と token exchange |
| [0003-managed-pricing-as-billing-source-of-truth](../adr/0003-managed-pricing-as-billing-source-of-truth.md) | Managed Pricing を billing truth に |
| [0004-app-specific-https-webhooks-only](../adr/0004-app-specific-https-webhooks-only.md) | app-specific / HTTPS only の webhook 方針 |

## プラットフォーム前提

- **Scope truth:** granted scopes は `currentAppInstallation.accessScopes` query で取得する。webhook payload を truth にしない（詳細は ADR-0002）。
- **Webhook:** app-specific / HTTPS only。運用を単純化し、public app 審査と整合させるため（詳細は ADR-0004）。
- **`/auth/login`:** ショップドメイン入力は **開発・手動確認向けの補助経路**。本番利用の主経路は **managed install** または **Admin からの埋め込み起動**（ADR-0002 と整合）。

## 検証ゲート

| ゲート | コマンド | 用途 |
| --- | --- | --- |
| 日常（CI / ローカル） | `pnpm check` | lint, contracts, ADR discipline, typecheck, build, smoke 一覧確認 |
| 提出前 | `pnpm run verify:pre-release` | 上記 + Playwright smoke 実走 |

詳細は [release-gate-matrix.md](release-gate-matrix.md) を参照。

## 11.4 review metadata

提出前の reviewer 向け truth は次を正本とする。

- `docs/app-review-metadata.md`
- `docs/reviewer-packet.md`
- `docs/release-gate-matrix.md`

外部リンク: `https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review`
