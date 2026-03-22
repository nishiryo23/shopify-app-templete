# P-005 DB, queue, artifact, crypto foundation plan

## Goal
Product Domain Parity MVP の write/verify/undo を支える永続化基盤を整え、後続の `PD-001` 以降が共通の queue・artifact・署名ユーティリティを前提に実装できる状態にする。

## Read first
- `tickets/platform/P-005-db-queue-artifact-crypto-foundation.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0006-aws-as-launch-infrastructure.md`
- `adr/0021-harness-template-scope.md`
- `.agents/skills/adr-discipline/SKILL.md`
- `.agents/skills/domain-feature-stub/SKILL.md`
- `prisma/schema.prisma`
- `app/services/shop-session-storage.server.ts`
- `domain/provenance/csv-manifest.mjs`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy は変更しない。
- 既存の offline token 暗号化を壊さず、秘密情報の暗号化 truth はアプリ内 crypto utility に集約する。
- queue は Shopify の bulk mutation 並列上限とは別に、app 側の `1 write job per shop` 制約を守れる設計にする。
- artifact は launch v1 では private storage 前提にし、公開 URL や長期公開バケットを前提にしない。
- Product feature 自体の write logic には踏み込まず、後続 ticket が使う foundation に限定する。

## Steps
1. 現行 Prisma schema と既存 session/webhook 永続化を棚卸しし、`job`、`job_attempt`、`artifact`、必要なら `crypto_key_version` 相当の保存責務を ADR と plan で固定する。
2. PostgreSQL-backed queue の domain/service 境界を定義し、enqueue、lease、heartbeat、complete、retry、dead-letter を app/service から使える最小 API として実装する。
3. shop 単位 single-writer を壊さないように、queue uniqueness と lease 条件に `shopDomain` と job kind を組み込み、Product write path で再利用できる shape にする。
4. artifact storage adapter を追加し、launch 時点では S3 互換 interface を正本にしつつ、ローカル/テスト用の in-memory もしくは filesystem adapter を用意する。
5. 既存 `domain/provenance/csv-manifest.mjs` と整合する形で、row fingerprint signing と verification に使う署名ユーティリティを共通化し、manifest・preview・undo が同じ鍵管理規約を参照できるようにする。
6. Prisma migration、integration test、storage adapter smoke、queue contract test を追加し、`pnpm check` が通るところまで仕上げる。

## ADR impact
- ADR required: yes
- ADR: 0007
- Why: DB queue、artifact storage、crypto/key management は background processing と launch infrastructure の source-of-truth そのものだから。

## Validation
- `pnpm run prisma:generate`
- `pnpm run test:contracts`
- queue integration test を追加して lease/retry/DLQ を確認
- artifact storage smoke を追加して private-by-default を確認
- `pnpm check`

## Risks / open questions
- review comment: queue テーブルを webhook inbox と混ぜずに独立させる。webhook inbox は ingress dedupe の責務、job queue は worker orchestration の責務であり、同一テーブル化すると retention と再試行戦略が衝突する。
- review comment: artifact metadata と実体保存先を分離する。DB には manifest/hash/retention status のみを置き、大容量 payload は object storage に逃がす前提にする。
- review comment: `SHOP_TOKEN_ENCRYPTION_KEY` と provenance signing key を同一鍵にしない。offline token の復号鍵と row fingerprint の署名鍵は悪用ベクトルが異なるため、環境変数も分離する。
- review comment: 既存インストールで新しい鍵や storage 設定が未投入の場合の挙動を実装前に固定する。少なくとも起動時 fail-fast にする項目と、開発環境だけ fallback を許す項目を分ける。
