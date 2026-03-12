# H-002 lint extension plan

## Goal
repo 共通の一般 lint を追加し、`pnpm check` で guardrail と contract tests に加えて構文・静的品質も確認できるようにする。

## Read first
- `tickets/harness/H-002-quality-gates-and-architecture-guardrails.md`
- `docs/codex_harness_bootstrap.md`
- `adr/0001-repo-truth-and-codex-harness.md`
- `https://nyosegawa.github.io/posts/harness-engineering-best-practices-2026/`
- `https://eslint.org/docs/latest/use/getting-started`
- `https://eslint.org/docs/latest/use/configure/configuration-files`

## Constraints
- 既存の custom architecture guardrail は置き換えず、その上に一般 lint を足す。
- 現在の repo は Node ESM ベースなので、最小の ESLint flat config を採用する。
- formatter や hook 前提の重い道具はこの段階では入れない。

## Steps
1. repo 構成に対して過不足の少ない lint として ESLint flat config を追加する。
2. `pnpm lint` と `pnpm check` を更新し、lint を共通 gate に統合する。
3. lint 実行で出る既存コードの問題を修正し、harness が壊れていないことを確認する。

## ADR impact
- `adr/0001-repo-truth-and-codex-harness.md` を更新

## Validation
- `pnpm lint`
- `pnpm check`

## Risks / open questions
- 今後 TypeScript や framework-specific config が入ったら override を追加する。
- hook/format 層を入れるなら将来 Oxlint/Biome を上に重ねる余地は残す。
