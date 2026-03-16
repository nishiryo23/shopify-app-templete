# PD-010 Handle changes and redirects plan

## Goal
`product-core-seo-v1` の handle 更新に対して、product write / verify / undo pipeline と整合する redirect 生成 contract を追加する。sitewide redirect 管理には広げず、product-linked redirect だけを対象にする。

## Read first
- `tickets/product-domain/PD-010-handle-changes-and-redirects.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `adr/0010-product-write-verify-and-undo-contract.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- Shopify Admin GraphQL `ProductInput.redirectNewHandle`
- Shopify Admin GraphQL `UrlRedirect` / `urlRedirectCreate` / `urlRedirectDelete`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract は変更しない。
- `PD-010` は `product-core-seo-v1` の handle change に紐づく redirect のみを扱い、独立した redirect import/export workflow は実装しない。
- write success truth は mutation 応答ではなく final-state verification のまま維持する。
- owner-only confirm、`ACTIVE_PAID` gate、shop 単位 single-writer、preview provenance contract は維持する。
- 既存 install で `read_online_store_navigation` / `write_online_store_navigation` が未反映のケースは追加しない。launch v1 の固定 scope 前提で扱う。
- undo surface を無制限に広げず、redirect rollback は handle rollback と同じ latest rollbackable write の範囲に閉じる。

## Steps
1. Shopify 公式 docs を正本に、handle change 時の redirect 生成手段を `productUpdate(input.handle + input.redirectNewHandle)` 中心で固定し、必要なら `UrlRedirect` read/delete を verify/undo に限定して使う方針を ADR で明文化する。
2. `adr/0017-product-handle-redirect-contract.md` を追加し、`product-core-seo-v1` における redirect 生成条件、verify truth、undo semantics、既存 redirect 競合時の扱い、artifact metadata を固定する。`adr/0005` は boundary の表現だけで足りるか確認し、semantic change がある場合のみ追記する。
3. `docs/shopify_app_requirements_definition_complete.md` と `docs/shopify_app_technical_spec_complete.md` を更新し、launch v1 の redirect は product-linked handle change に限定されること、online store navigation scope を使う理由、bulk redirect workflow が out-of-scope のままなことを明文化する。
4. `domain/products` と `platform/shopify` の write/verify/undo 実装を更新し、handle 変更 row だけ redirect metadata を保持しながら write し、verification で product handle と redirect の両方を確認できるようにする。
5. preview / write route / preview shell を更新し、handle change に redirect impact があることを要約表示できるようにする。warning と error の線引きは preview artifact に残す。
6. `tests/contracts/product-write.contract.test.mjs` を中心に、handle change の verified redirect success、redirect verify failure、undo rollback、preview UI 表示を追加する。必要なら専用 contract test を切り出す。

## ADR impact
- ADR required: yes
- ADR: 0017
- Why: handle change に redirect 生成と rollback metadata を足すと、`product-core-seo-v1` の write/verify/undo source-of-truth が増えるため。これは docs だけでなく artifact metadata と verification contract の変更を伴う。
`adr/0005-product-domain-parity-mvp-boundary.md` は boundary の表現が変わる場合のみ追記対象として確認する。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- handle change + redirect の write/verify/undo contract tests
- `tests/smoke/preview-shell.spec.mjs` の profile / copy 回帰確認

## Risks / open questions
- Shopify 公式 docs 上は `ProductInput.redirectNewHandle` が存在する。`urlRedirectCreate` を直接使う必要があるかは verify/undo の read/delete 要件次第なので、実装前に mutation と権限境界を再確認する。
- 既存 redirect が同じ旧 handle に存在する場合の update vs fail-fast は merchant 事故に直結するため、暗黙上書きにしない方針を優先する。
- handle rollback 時に redirect をどこまで自動削除するかは source-of-truth を曖昧にしやすい。write artifact に redirect identity を残せない設計なら undo は fail-fast に寄せる。
