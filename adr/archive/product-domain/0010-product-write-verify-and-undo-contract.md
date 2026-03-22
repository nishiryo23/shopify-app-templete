# ADR-0010 Product write, verify, and undo contract

- Status: Accepted
- Date: 2026-03-14
- Owners: Codex

## Context
`PD-003` では `PD-002` の preview artifact を正本にして product core write / verify / undo を追加するが、owner-only confirm、billing gate、snapshot truth、latest rollbackable write lookup、undo conflict detection の contract が未固定だった。

preview は未課金でも許可される一方、write/undo は Shopify 上の mutation を伴うため、route contract と worker truth を preview と同じ artifact/queue 基盤の上に定義する必要がある。

## Decision
- write request は `POST /app/product-writes`、undo request は `POST /app/product-undos` で受ける。
- write/undo route は `authenticateAndBootstrapShop(request)` を通し、`session.accountOwner === true` と current entitlement `ACTIVE_PAID` を必須にする。
- write の入力正本は same-shop の completed `product.preview` job と non-deleted `product.preview.result` artifact に固定する。preview result payload に `format` が追加されても、write/undo が参照する正本は `rows`, `summary`, `baselineDigest`, `editedDigest`, `previewDigest` の canonical row semantics のままとする。
- write route の writable 判定は `row.changedFields.length > 0` を正本にし、warning/unchanged だけの preview は reject する。
- repeated confirm の deny は `previewJobId` 単位に固定し、same preview job に対する latest `verified_success` write が存在する場合は再 confirm を reject する。`previewDigest` 単位の cross-job dedupe は行わない。
- write worker は preview artifact の `currentRow` を frozen baseline として再検証し、一致しない row が 1 件でもあれば mutation を行わず `revalidation_failed` result を保存する。
- write snapshot は revalidation 後、最初の mutation 前に `product.write.snapshot` artifact として保存する。
- product core write/undo は Shopify Admin GraphQL `productUpdate` を使い、mutation/verification/undo conflict は changed-fields-only semantics に固定する。
- write result artifact は `product.write.result`、undo result artifact は `product.undo.result` とし、business outcome は `metadata.outcome` を正本にする。
- undo 対象は same-shop / same-profile の latest non-deleted `product.write.result` のうち、snapshot artifact を持ち、`metadata.outcome` が rollback 可能な write に固定する。launch 時点では `verified_success` と `partial_failure` を rollbackable とし、`verified_failure` / `revalidation_failed` は undo 対象外とする。
- write 中に infrastructure failure が発生した場合でも、snapshot 作成後に少なくとも 1 row の mutation 判定へ進んでいたら `product.write.result` を先に保存し、続けて `product.write.error` artifact を保存して dead-letter にする。これにより部分適用済み write の rollback metadata を失わない。
- preview / write / undo は既存 PostgreSQL-backed queue と shop 単位 lease をそのまま使い、同一 shop では export/write/undo を直列実行する。

## Consequences
- owner/billing gate を route で fail-fast できる。
- latest rollbackable write only の undo truth が `Artifact.metadata.outcome` / `snapshotArtifactId` と `createdAt` で一意に決まる。
- write と undo は merchant が実際に編集した fields だけを mutation/verification/rollback 対象にし、stale unrelated field を上書きしない。
- CSV/XLSX のどちらから preview が生成されても、write/undo contract は preview artifact の canonical rows にのみ依存するため、format によって mutation semantics は変わらない。
- same preview job の再 confirm が history と undo 対象を汚さない。

## Alternatives considered
- write/undo を preview と同じ未課金可にする案
  mutation を伴うため、billing truth と衝突しやすく不採用。
- undo conflict を full-row equality にする案
  merchant が編集していない unrelated field drift まで rollback blocker になり、changed-fields-only semantics と矛盾するため不採用。
- repeated confirm を `previewDigest` 単位で cross-job dedupe する案
  preview job の再生成 policy と history truth を広げるため不採用。

## References
- `tickets/product-domain/PD-003-product-core-write-verify-undo.md`
- `adr/0007-db-queue-artifact-and-provenance-crypto-truth.md`
- `adr/0009-product-preview-route-and-provenance-contract.md`
- `https://shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate`
- `https://shopify.dev/docs/api/admin-graphql/latest/input-objects/productupdateinput`
