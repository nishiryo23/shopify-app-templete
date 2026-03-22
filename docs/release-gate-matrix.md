# Release Gate Matrix

## Purpose
App Store submission 前に必要な readiness gate を 1 つの matrix で確認する。

## 日常 vs 提出前ゲート

| ゲート | コマンド | 用途 |
| --- | --- | --- |
| 日常（CI / ローカル） | `pnpm check` | lint, contracts, ADR discipline, typecheck, build, **smoke 一覧確認**（実走ではない） |
| 提出前 | `pnpm run verify:pre-release` | 上記 **+ Playwright smoke 実走**。URL / 認証情報が必要。 |

## Matrix
| Gate | Evidence | Pass condition | Current blocker |
| --- | --- | --- | --- |
| Review metadata configured | `docs/app-review-metadata.md` | support email / submission contact email / privacy policy URL が実値で埋まり、Partner Dashboard と一致する | `UNCONFIGURED_BEFORE_SUBMISSION` が残っている間は fail |
| Reviewer packet reproducible | `docs/reviewer-packet.md` | install -> reinstall -> embedded `/app` -> `/app/pricing` -> invalid-session path が docs と smoke で一致する | packet と smoke checklist の不一致 |
| Dev-store smoke complete | `docs/dev-store-smoke-checklist.md` | `pnpm run test:smoke` を reviewer path 相当の URL で完走する | dry-run 未実施または evidence 未更新 |
| Fatal-free primary routes | embedded `/app`, `/app/pricing`, invalid-session paths | reviewer/admin URL でも fatal-free に表示される | fatal UI error or missing storage state |
| Contract/build gate complete | `pnpm check` | lint, contracts, ADR discipline, typecheck, build, smoke **一覧** が通る（実走は別行の Dev-store smoke） | any `pnpm check` failure |

## Submission rule
1. `docs/app-review-metadata.md` に sentinel が残っている場合は提出しない。
2. `docs/reviewer-packet.md` の dry-run evidence を更新せずに reviewer へ URL を共有しない。
3. **提出直前は `pnpm run verify:pre-release`** を実行し、この matrix の全 pass condition を満たすこと。
