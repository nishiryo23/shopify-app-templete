# ADR

このディレクトリは architecture decision records を置く。

## Rules

- 新しい設計判断は ticket 実装前に ADR を作る
- 既存判断の更新は supersede ではなく update でもよいが、差分を明記する
- ADR 番号は 4 桁ゼロ埋め
- ticket / PR / change summary に ADR 番号を残す
- auth / billing / webhooks / config / schema の truth を変える差分は `pnpm check` で ADR 更新が必須になる
- `plans/*.md` の `ADR impact` には `ADR required` と `ADR` 番号を明記する

## Active ADR（テンプレ）

- 0001: repo truth and Codex harness
- 0002: embedded auth and token exchange
- 0003: managed pricing as billing truth（billing entitlement は 0027 に superseded）
- 0004: app-specific HTTPS webhooks only
- 0006: AWS as launch infrastructure
- 0007: DB queue artifact and crypto separation（worker は provenance key を必須としないテンプレに合わせ、ECS からは省略可）
- 0018: webhook inbox raw payload retention boundary
- 0019: app review metadata and reviewer packet truth
- 0021: harness template scope（ドメイン非同梱）
- 0022: Polaris admin UI baseline and conventions
- 0023: empty minimal access scopes baseline
- 0024: API version single truth and CI gate
- 0025: fork initialization script truth
- 0026: growth kit funnel privacy and review prompt
- 0027: Partner API billing entitlement truth

## Archive

- `adr/archive/product-domain/`: 旧 Product Domain Parity MVP 専用 ADR（参照・履歴用）
