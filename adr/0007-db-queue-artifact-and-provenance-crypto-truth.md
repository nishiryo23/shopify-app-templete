# ADR-0007 DB queue, artifact, and provenance crypto truth

- Status: Accepted
- Date: 2026-03-13
- Owners: Codex

## Context
Product Domain Parity MVP は preview / write / verify / undo を前提とするため、webhook inbox とは別に worker が扱う durable queue、private artifact 保存、row fingerprint 署名の正本が必要になる。

既存 repo には `Session` / `Shop` / `WebhookInbox` まではあるが、product write path の共通基盤となる `Job` / `JobAttempt` / `Artifact` と、offline token 暗号化から独立した provenance signing key の扱いが未定義だった。

## Decision
- webhook ingress dedupe 用の `WebhookInbox` と、worker orchestration 用の `Job` / `JobAttempt` は別テーブルにする。
- queue truth は PostgreSQL 上の `Job` / `JobAttempt` に置き、lease / retry / dead-letter を永続化する。
- app は shop 単位 `1 write job per shop` を守るため、`JobLease` を shop ごとの CAS lock として持ち、lease token 一致時のみ complete / fail / heartbeat / release を許可する。
- heartbeat は `JobLease` と `Job` の両方で未失効 lease を条件に延長し、期限切れ lease の自己延命を許可しない。
- artifact metadata は PostgreSQL の `Artifact` に保持し、payload 実体は private storage adapter に保存する。
- artifact visibility は launch v1 では `private` のみ許可し、public URL 前提の保存は採用しない。
- artifact object key は危険な入力を正規化で救済せず、storage root 外に解釈され得る key を fail-fast で reject する。
- artifact retention は kind ごとの `retentionUntil` を write 時点で確定し、retention sweep は S3 delete と `Artifact.deletedAt` soft-delete を idempotent に整合させる。
- provenance signing は `PROVENANCE_SIGNING_KEY` を使い、offline token の `SHOP_TOKEN_ENCRYPTION_KEY` と分離する。
- `PROVENANCE_SIGNING_KEY` が未設定のまま署名処理を呼んだ場合は fail-fast する。
- `WebhookInbox` は ingress audit log のまま維持し、backlog/state machine へ広げない。raw payload retention boundary の詳細は `adr/0018-webhook-inbox-raw-payload-retention-boundary.md` を正本とし、未処理 residue は state 遷移せず telemetry で検知する。
- system sweeps は新テーブルを増やさず、`shopDomain="__system__"` を使って queue 上で直列実行する。
- scheduler window の重複 enqueue は `Job_shopDomain_kind_dedupeKey_active_key` に加えて、system job 専用の partial unique index で `dead_letter` 以外の同一 window 再投入を防ぐ。

## Consequences
- `PD-001` 以降は共通 queue と artifact adapter を前提に preview / write / verify / undo を積み上げられる。
- webhook inbox の retention / dedupe と job retry policy が分離され、運用ポリシーの衝突を避けられる。
- 鍵用途を分離することで、token 復号鍵漏えいと manifest 署名鍵漏えいの影響範囲を分断できる。
- `P-006` ではこの truth を前提に S3 / KMS / ECS wiring を定義する。
- rollback/history download は 90 日以内のみ保証し、rollbackable job はあるが required artifact が soft-delete 済みの場合は `retention_expired` を返す。

## Alternatives considered
- `WebhookInbox` をそのまま job queue に流用する案
  dedupe と retry/DLQ の責務が異なり、state と retention が衝突するため不採用。
- artifact を DB のみで保持する案
  preview / result / error artifact の payload が大きくなりやすく、launch infrastructure の object storage 方針と整合しないため不採用。
- offline token と provenance signing で同一鍵を使う案
  悪用ベクトルとローテーション要件が異なるため不採用。

## References
- `tickets/platform/P-005-db-queue-artifact-crypto-foundation.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0006-aws-as-launch-infrastructure.md`
