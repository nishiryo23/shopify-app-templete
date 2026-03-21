# ADR-0008 Product export route and artifact contract

- Status: Accepted
- Date: 2026-03-13
- Owners: Codex

## Context
`PD-001` では Product Domain Parity MVP の最初の export workflow を追加するが、現行 repo にある truth は queue (`Job` / `JobAttempt`) と artifact catalog (`Artifact`) までで、export route contract、manifest の保存形、offline session 不在時の挙動は未固定だった。

また、`ADR-0007` は artifact metadata を PostgreSQL に置き payload を private storage に置く方針を定めているため、export manifest 専用テーブルを追加すると truth が分散しやすい。

## Decision
- embedded app からの export request は `POST /app/product-exports` で受ける。
- route は `authenticate.admin(request)` で shop を確定し、business logic は service 層に寄せる。
- export profile は launch scope の product-domain profiles を受け、列順は各 profile の canonical header を正本にする。
- export format は `csv | xlsx` を受ける。active export dedupe は DB の active unique index を正本にし、service 層は duplicate enqueue 後に既存 active job を lookup して返す。terminal へ遷移済みの latest job は accepted response に使わず、active job が見えないまま再 enqueue も取れなければ enqueue failure として扱う。対象は `shopDomain + kind=product.export + dedupeKey=product-export:{profile}:{format}`。
- manifest は新しい DB table ではなく private artifact として保存する。`Artifact.metadata` には lookup に必要な要約だけを入れ、row fingerprint 群の正本は manifest artifact payload に置く。
- export 成功時に保存する artifact は `product.export.source` と `product.export.manifest` の 2 種類のみとする。
- artifact 保存は `storage put x2 -> catalog record x2` の順に行い、途中失敗時は delete / `markDeleted` による補償処理で partial state を残さない。
- worker は `unauthenticated.admin(shop)` を使って offline Admin client を取得する。offline session 不在は retryable error にせず terminal failure とし、`product.export` job は `maxAttempts: 1` にする。
- worker は leased job 実行中に `heartbeat()` で lease を延長し続ける。Shopify product reader は cursor page ごとに lease を確認し、lease を失ったら追加 page fetch と artifact side effect を続行しないよう fence を掛ける。canonical source rows は temp CSV として逐次書き出し、manifest はその canonical rows から生成する。`format=xlsx` の場合も canonical rows を正本にし、download artifact としてだけ workbook を生成する。`SIGINT` / `SIGTERM` では新規 lease を止め、in-flight job の `complete()` / `fail()` が終わってから Prisma を disconnect する。
- local development でも export contract を成立させるため、`shopify app dev` の dev command は web だけでなく worker も同時起動する。worker 単体再起動パスは別に持ってよいが、CLI tunnel URL を `SHOPIFY_APP_URL` に解決できない状態では fail-fast させ、`product.export` job を `queued` のまま見せかけにしない。
- artifact key に使う `S3_ARTIFACT_PREFIX` は bootstrap で解決した worker config を job 実行へ注入し、`process.env` を再参照しない。
- S3 artifact storage も filesystem / memory backend と同じく structured read で descriptor metadata を返す。metadata は object metadata に保存して round-trip させる。
- export 本体成功後の `complete()` 失敗は export 本体 failure と扱わない。`fail()` へ落として retry/dead-letter に変換せず、worker 異常として surface する。

## Consequences
- export manifest の truth は既存 artifact 方針に揃い、別テーブルを増やさずに済む。
- CSV/XLSX のどちらでも manifest は canonical rows を正本にでき、preview/write contract は file binary ではなく row semantics に依存できる。
- repeated POST に対しては既存 active job を返せるが、正本は DB active unique index なので route/service contract test と migration truth の両方が重要になる。
- offline session 不在で無意味な再試行を避けられる。
- local development でも export UI と queue worker の分断に気づきやすくなり、download link が出ない原因を job 状態から素直に追える。
- 長時間 export や rolling deploy 中でも stale lease による重複実行と state 未確定を起こしにくくなり、大きい catalog でも worker memory を export サイズに比例して膨らませにくい。
- variants / inventory / media などは `product-core-seo-v1` を壊さず、後続 ticket で profile/version を追加する前提になる。

## Alternatives considered
- `ExportManifest` テーブルを新設する案
  artifact metadata truth と競合しやすく、lookup と retention の責務が二重化するため不採用。
- export も queue の `1 write job per shop` truth に明示的に含める案
  `ADR-0007` の write job truth を広げることになり、この ticket の責務を超えるため不採用。
- offline session 不在を retryable にする案
  install/bootstrap 不整合では自然回復しにくく、無駄な再試行を増やすため不採用。

## References
- `tickets/product-domain/PD-001-product-export-foundation.md`
- `adr/0007-db-queue-artifact-and-provenance-crypto-truth.md`
- `docs/shopify_app_technical_spec_complete.md`
