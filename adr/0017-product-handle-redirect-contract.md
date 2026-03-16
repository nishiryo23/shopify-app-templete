# ADR-0017 Product handle redirect contract

- Status: Accepted
- Date: 2026-03-15
- Owners: Codex

## Context
`PD-010` では product handle change を Product Domain Parity MVP の write / verify / undo pipeline に拡張する。既存 truth は `adr/0010-product-write-verify-and-undo-contract.md` にある `product-core-seo-v1` の changed-fields-only write / verify / undo contract だが、handle change に伴う redirect 生成はまだ固定されていない。

redirect は launch v1 の scope に含まれる一方、sitewide redirect 管理まで広げると別 workflow になる。`PD-010` では product-linked handle redirects だけを `product-core-seo-v1` の責務として閉じ、preview artifact と write result metadata の範囲で扱う必要がある。

## Decision
- `PD-010` の redirect 対象は `product-core-seo-v1` の handle edit row に限定し、独立した redirect import/export profile は追加しない。
- canonical storefront path は `/products/{handle}` に固定する。
- handle change の write path は Shopify Admin GraphQL `productUpdate` の `input.handle` と `input.redirectNewHandle` を正本にする。
- preview と write 前再検証では `path=/products/{previousHandle}` の live redirect 不在を必須 precondition とする。既存 redirect が 1 件でもあれば merchant-facing error または job-level `revalidation_failed` として止める。
- edited handle は Shopify の handle 契約をそのまま検証し、app 内で独自 slugify して redirect path truth を作らない。
- redirect の verification truth は product handle の final-state verification に加えて、`path=/products/{previousHandle}` かつ `target=/products/{nextHandle}` の redirect が live state にちょうど 1 件あることに置く。
- redirect の read/delete は verify と undo のためにだけ補助的に扱い、bulk redirect management や sitewide URL cleanup には広げない。
- write result artifact には handle change row ごとの redirect verification outcome、`rollbackableHandleChange`、`redirectCleanupMode` を持たせる。
- rollbackable 判定の正本は redirect verify 成否ではなく handle mutation 適用有無とする。handle は更新されたが redirect verify に失敗した row も undo 対象から外さない。
- undo は latest rollbackable `product-core-seo-v1` write のみを対象にし、`product.write.snapshot` と `product.write.result` を `productId` で join した上で rollback 対象行を決める。
- handle rollback は redirect cleanup を先に行い、その後 `productUpdate(handle=<previousHandle>)` で restore する。reverse redirect は生成しない。
- `delete-by-id` cleanup の `not found` は cleanup 済みとして扱う。join mismatch は business conflict ではなく technical error として `product.undo.error` artifact を保存して abort する。
- undo verification は restore 後の handle final-state に加え、`path=/products/{previousHandle}` の live redirect が 0 件であることを要求する。same-path redirect が残っていれば exact target が消えていても success 扱いにしない。
- 既存 redirect と衝突する場合は暗黙上書きしない。

## Consequences
- launch v1 の redirect scope を product-linked handle changes に閉じたまま、write / verify / undo の source-of-truth を拡張できる。
- route contract を新設せず、既存 `POST /app/product-writes` と `POST /app/product-undos` の内側で扱える。
- redirect 競合、rollback cleanup、technical error を artifact metadata と contract tests で再現できる。

## Alternatives considered
- `urlRedirectCreate` を handle change の主 write pathにする案
  product update と redirect creation が分離し、`product-core-seo-v1` の changed-fields-only contract が複雑化するため不採用。
- redirect verify を省略して `productUpdate` 成功だけで完了扱いにする案
  write success truth が final-state verification ではなく mutation 成功へ後退するため不採用。
- same-path の既存 redirect を reuse して undo で delete する案
  この write が作っていない redirect を rollback で消す危険があるため不採用。
- sitewide redirect workflow を同 ticket に含める案
  ticket 粒度と launch scope が広がりすぎるため不採用。

## References
- `tickets/product-domain/PD-010-handle-changes-and-redirects.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `adr/0010-product-write-verify-and-undo-contract.md`
- `https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ProductInput`
- `https://shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate`
- `https://shopify.dev/docs/api/admin-graphql/latest/objects/UrlRedirect`
