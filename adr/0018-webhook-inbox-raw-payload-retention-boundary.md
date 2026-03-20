# ADR-0018 Webhook inbox raw payload retention boundary

- Status: Accepted
- Date: 2026-03-17
- Owners: Codex

## Context
`O-001` では observability / retention sweep を launch 前の運用 contract として固定する。既存 truth は `adr/0007-db-queue-artifact-and-provenance-crypto-truth.md` にあり、`WebhookInbox` を durable ingress audit log として維持しつつ、未処理 residue は telemetry で検知する設計を採っている。

一方で `WebhookInbox` の payload 面には `rawBody` と `hmacHeader` が残るため、`processedAt` を retention の境界にすると、未処理 residue が長期間残った場合に raw payload を無期限に保持し得る。`tickets/operability/O-001-observability-telemetry-retention-sweeps.md` の acceptance は「7日超 telemetry に shop-identifiable data が残らない」であり、launch 前に webhook raw payload の retention 上限も明文化する必要がある。

Shopify app review / privacy 観点でも、webhook の raw payload は HMAC 検証と topic routing のために短期保持し得るが、長期保持の正当化までは不要である。debug や residue triage は payload ではなく metadata と pseudonymous telemetry に寄せるほうが launch 運用に整合する。

## Decision
- `WebhookInbox` は durable ingress metadata の正本として維持するが、`rawBody` と `hmacHeader` は transient payload とみなし、`createdAt` から 7 日を超えて保持しない。
- retention sweep は `processedAt` の有無に関わらず、7 日超の inbox row で `rawBody` または `hmacHeader` が残っていれば両方を redact する。
- 未処理 residue は 7 日経過後も metadata-only row として残してよい。運用検知は `processedAt=null` の residue 件数と telemetry event を正本にする。
- `WebhookInbox` の retention は「ingress からの最大保持期間」であり、「処理完了からの保持期間」ではない。
- webhook の business logic や forensic に raw payload が必要な処理は、この 7 日境界より前に完了させる。7 日超の backlog 回復は metadata と external system truth を使って行い、redacted payload の復元は前提にしない。
- dedupe key / topic / shop domain / webhook id / subscription name / createdAt / processedAt は launch v1 の ingress audit metadata として残す。shop-identifiable な長期運用指標が必要な場合は pseudonymous telemetry に落とす。

## Consequences
- privacy / retention の境界が `processedAt` 依存ではなくなり、未処理 residue が raw payload を無期限保持する穴を閉じられる。
- backlog が 7 日を超えた webhook は metadata-only residue になるため、payload を使った後追い再処理はできない。運用は telemetry alert と metadata triage を前提にする。
- 現行の app-specific lifecycle webhook (`app/uninstalled`, `app/scopes/update`) は ingress 直後に処理完了するため、通常系の挙動は変わらない。
- observability contract の `webhookPayloadRetentionDays` は「ingress からの最大 raw payload age」を意味する。

## Alternatives considered
- `processedAt` 済み payload だけを 7 日後に redact し、未処理 residue は raw payload を保持し続ける案
  privacy 上限が state 依存となり、stalled residue だけが無期限保持になるため不採用。
- 未処理 residue を 7 日で hard delete する案
  dedupe / audit metadata と運用トリアージの手掛かりまで失うため不採用。
- payload を永続暗号化のまま 30 日以上残す案
  launch 運用に対して保持理由が弱く、acceptance の 7 日境界とも整合しないため不採用。

## References
- `tickets/operability/O-001-observability-telemetry-retention-sweeps.md`
- `tickets/platform/P-004-webhooks-uninstall-redact-lifecycle.md`
- `adr/0004-app-specific-https-webhooks-only.md`
- `adr/0007-db-queue-artifact-and-provenance-crypto-truth.md`
- `https://shopify.dev/docs/apps/build/webhooks`
- `https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance`
