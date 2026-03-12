# ADR-0001 Repo truth and Codex harness

- Status: Accepted
- Date: 2026-03-11

## Context
Codex では hook-heavy 運用よりも repo-local な truth と deterministic gates が効く。

## Decision
- root `AGENTS.md` を短い pointer にする
- `.agents/skills/*/SKILL.md` を使う
- 1 session = 1 ticket
- plan-first
- docs より code/test/ADR を truth に置く
- 一般 lint は ESLint flat config を repo 共通基盤として使う
- `pnpm check` を repo 共通の harness gate とする
- `pnpm check` では ESLint、contract tests、routes -> service boundary、no direct Admin API access、no webhook inline business logic、Playwright smoke skeleton を固定する
- no direct Admin API access は static URL object の `href` だけでなく `toString()` も同義として扱う
- Shopify review remediation の 1 pass command は `$shopify-review-fix` を正本にする
- Shopify admin reviewer URL を使う smoke では認証済み browser state を必須にする
- Shopify review loop の resume は last review state を保持し、失敗時も fix thread id を出力する

## Consequences
Codex の作業導線が単純になり、セッションごとの差が減る。
