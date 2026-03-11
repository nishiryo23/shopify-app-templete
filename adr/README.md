# ADR

このディレクトリは architecture decision records を置く。

## Rules
- 新しい設計判断は ticket 実装前に ADR を作る
- 既存判断の更新は supersede ではなく update でもよいが、差分を明記する
- ADR 番号は 4 桁ゼロ埋め
- ticket / PR / change summary に ADR 番号を残す

## Seed ADR
- 0001: repo truth and Codex harness
- 0002: embedded auth and token exchange
- 0003: managed pricing as billing truth
- 0004: app-specific HTTPS webhooks only
- 0005: Product Domain Parity MVP boundary
- 0006: AWS as launch infrastructure
