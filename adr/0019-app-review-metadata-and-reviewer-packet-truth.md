# ADR-0019 App review metadata and reviewer packet truth

- Status: Accepted
- Date: 2026-03-18

## Context
technical spec 11.4 と `O-002` は support email、submission contact email、privacy policy URL、reviewer packet を review metadata として要求している。一方で repo には reviewer 向け packet や release gate の truth source がなく、dev store smoke checklist だけでは reviewer が辿る提出経路と submission 前 gate を再現できなかった。

## Decision
- review metadata の repo truth を `docs/app-review-metadata.md` に置く
- reviewer 向け経路と dry-run 証跡の truth を `docs/reviewer-packet.md` に置く
- submission 前 gate の truth を `docs/release-gate-matrix.md` に置く
- support email、submission contact email、privacy policy URL が未確定の間は `UNCONFIGURED_BEFORE_SUBMISSION` sentinel を残し、submission blocker として扱う
- reviewer path は `docs/dev-store-smoke-checklist.md` の smoke path と一致させる

## Consequences
review metadata と reviewer path の source-of-truth が repo に揃い、review readiness の差分を contract test で固定できる。実値が未確定の metadata は明示的 blocker として残るため、不明な連絡先や URL を捏造して提出する事故を防げる。

## Alternatives considered
- Partner Dashboard 上の設定だけを truth にする
  - repo から再現できず、review readiness を PR/contract review で検証できないため不採用
- 実値が揃うまで docs を追加しない
  - reviewer packet 不在の状態が続き、smoke checklist と提出手順の整合も固定できないため不採用

## References
- `docs/shopify_app_technical_spec_complete.md`
- `tickets/operability/O-002-app-review-readiness-and-release-gate.md`
- `docs/dev-store-smoke-checklist.md`
- `https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review`
- `https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review`
- `https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements`
