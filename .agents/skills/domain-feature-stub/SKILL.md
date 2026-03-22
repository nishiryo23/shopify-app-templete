---
name: domain-feature-stub
description: Copy this skill when adding a new app domain after the harness template; defines ticket + ADR + contract-first workflow.
---

# Domain feature stub

## When to use

新しい merchant 向け機能（例: 独自のバルク処理、外部連携）を ticket で追加するとき。このファイルを **複製** し、`domain-<your-area>/SKILL.md` にリネームしてから中身を書き換える。

## Workflow

1. `docs/template_scope.md` を更新し、launch 境界を明文化する。
2. `tickets/` に ticket を追加し、`plans/<id>.md` を作る。
3. route contract / retention / billing / webhook に触れるなら **先に ADR**。
4. `tests/contracts/` に acceptance を追加し、`pnpm check` を緑にする。

## Truth

- ルートは薄く保ち、ビジネスロジックは `domain/` と `app/services/` に置く（既存 guardrails に従う）。
- direct Admin API / REST Admin は使わない。
