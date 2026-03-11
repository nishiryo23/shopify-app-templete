# ADR-0001 Repo truth and Codex harness

- Status: Accepted

## Context
Codex では hook-heavy 運用よりも repo-local な truth と deterministic gates が効く。

## Decision
- root `AGENTS.md` を短い pointer にする
- `.agents/skills/*/SKILL.md` を使う
- 1 session = 1 ticket
- plan-first
- docs より code/test/ADR を truth に置く

## Consequences
Codex の作業導線が単純になり、セッションごとの差が減る。
