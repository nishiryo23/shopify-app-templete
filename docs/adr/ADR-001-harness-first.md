# ADR-001: ハーネスファースト戦略

## Status
Accepted

## Date
2026-03-11

## Context
Codex による段階的な Shopify 公開アプリ開発を行う。
エージェントの出力品質はプロンプト指示だけでは安定しない。
実装コードを書く前に品質強制の仕組み（ハーネス）を整備する必要がある。

## Decision
- Phase 0（H-001〜H-004）でハーネスを先に整備する。
- AGENTS.md はポインタ型で 50 行以下を維持する。
- 仕様・期待動作・制約は可能な限りテストとして表現する。
- アーキテクチャ決定は ADR として不変に記録する。
- 品質ゲート（lint:arch, test:unit, test:int, check）をチケット完了条件にする。

## Consequences
- 初期の実装速度は遅くなるが、以降のすべてのセッションでハーネスが複利的に効く。
- ハーネスチケット完了前にプロダクトチケットに着手することを禁止する。

## References
- tickets/README.md Phase 0
- tickets/H-001.md 〜 H-004.md
- AGENTS.md Quality gates セクション
