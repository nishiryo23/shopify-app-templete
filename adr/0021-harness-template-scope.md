# ADR 0021: Harness template scope (no bundled domain)

## Status

Accepted

## Context

このリポジトリは特定アプリのドメイン実装ではなく、**Codex ハーネス＋最小 Shopify プラットフォーム**を fork 元とするテンプレートである。

## Decision

- ドメイン機能（例: 商品バルク）は含めない。旧 ADR・実装は `adr/archive/product-domain/` に退避する。
- 新規ドメインは ticket / plan / ADR を追加してから実装する。
- `ShopifyAppTemplate/Operations` 等のリソース名は fork 時にアプリ名へ置換する。

## Consequences

- `pnpm check` はテンプレの契約（billing / webhook / worker / infra）にフォーカスする。
- ドメイン用の契約・worker job kind は追加 ticket で導入する。
