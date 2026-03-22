---
doc_type: review_artifact
authority: supporting
truth_sources:
  - docs/platform-truth-index.md
  - docs/reviewer-packet.md
  - docs/release-gate-matrix.md
  - adr/0019-app-review-metadata-and-reviewer-packet-truth.md
---

# App Review Metadata

## Purpose
Shopify App Store submission 前に、review metadata の source-of-truth を repo で固定する。

## Canonical fields
| Field | Value | Source of truth |
| --- | --- | --- |
| Support email | `UNCONFIGURED_BEFORE_SUBMISSION` | Shopify Partner Dashboard の support contact と一致させる |
| Submission contact email | `UNCONFIGURED_BEFORE_SUBMISSION` | Shopify App Review submission contact と一致させる |
| Privacy policy URL | `UNCONFIGURED_BEFORE_SUBMISSION` | 公開 privacy policy URL と一致させる |
| Reviewer packet | `docs/reviewer-packet.md` | reviewer へ渡す手順書 |
| Release gate matrix | `docs/release-gate-matrix.md` | submission 前の必須 gate |

## Submission gate
1. `UNCONFIGURED_BEFORE_SUBMISSION` が残っている間は提出しない。
2. Partner Dashboard 上の support email / submission contact email / privacy policy URL はこのファイルと一致させる。
3. reviewer に案内する path は `docs/reviewer-packet.md` と `docs/dev-store-smoke-checklist.md` の両方で一致させる。

## Owner checklist
- support email を設定したら、このファイルと Partner Dashboard を同時に更新する。
- submission contact email を設定したら、このファイルと reviewer packet の連絡先欄を同時に更新する。
- privacy policy URL を設定したら、公開 URL の疎通確認と reviewer packet 反映を同時に行う。
