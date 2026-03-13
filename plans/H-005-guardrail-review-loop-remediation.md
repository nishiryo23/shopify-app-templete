# H-005 guardrail review loop remediation plan

## Goal
architecture guardrail の `URL#toString()` bypass と、review loop fix prompt の command mismatch を解消する。

## Read first
- `adr/0001-repo-truth-and-codex-harness.md`
- `docs/codex-sdk-review-loop.md`
- `scripts/check-architecture-guardrails.mjs`
- `scripts/lib/codex-review-loop.mjs`
- `tests/contracts/architecture-guardrails.contract.test.mjs`
- `tests/contracts/codex-review-loop.contract.test.mjs`

## Constraints
- `pnpm check` の gate semantics は維持する
- direct Admin API access 検出は false negative を増やさない方向で拡張する
- remediation prompt は repo の documented command と一致させる

## Steps
1. `URL#toString()` が direct Admin API access として再現する fixture と contract を追加する
2. guardrail の static string resolver を `href` と同様に `toString()` も canonicalize する
3. review loop fix prompt と関連 docs/test を `$shopify-review-fix` に揃える
4. `pnpm run test:contracts` と `pnpm check` で検証する

## ADR impact
- ADR required: yes
- ADR: 0001
- Why: harness gate と remediation prompt の repo truth を更新するため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`

## Risks / open questions
- `toString` を一般メソッドとして広く解釈すると誤検知しうるため、`URL` 由来の static string resolution に限定して canonicalize する
