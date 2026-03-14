# PD-003 Product core write / verify / undo plan

## Goal
`PD-002` の completed preview を正本にして、owner-only confirm、async write、final-state verification、latest rollbackable write only の undo を product core fields 向けに追加する。

## Read first
- `tickets/product-domain/PD-003-product-core-write-verify-undo.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `adr/0007-db-queue-artifact-and-provenance-crypto-truth.md`
- `adr/0009-product-preview-route-and-provenance-contract.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Constraints
- `shopify.app.toml`、scope、webhook policy、privacy/delete contract は変更しない。
- `PD-003` は product core fields のみ。variants / inventory / media / metafields は含めない。
- write/undo の operator surface は existing `/app/preview` に統合し、新しい dedicated page は作らない。
- write route の writable 判定は `row.changedFields.length > 0` を正本にし、warning/unchanged だけの preview は reject する。
- undo 対象は snapshot を持つ latest rollbackable write に固定し、`verified_success` と `partial_failure` を許可する。

## Steps
1. `adr/0010-product-write-verify-and-undo-contract.md` を追加し、owner/billing gate、write/undo route contract、snapshot/write/undo artifact truth、latest rollbackable write lookup を固定する。
2. `product.write` / `product.undo` の profile、dedupe、artifact key、latest-success lookup を domain module に追加する。
3. Shopify `productUpdate` を使う product core write/undo platform module と、canonical mutation input / verification helper を追加する。
4. write worker で preview revalidation、snapshot 保存、mutation、final verification、result/error artifact 保存を実装する。
5. undo worker で latest rollbackable write の snapshot/result 読み込み、conflict detection、rollback、verification、result/error artifact 保存を実装する。
6. `/app/product-writes` と `/app/product-undos` の service/route を追加し、existing `/app/preview` loader/UI に owner/billing state、write/undo polling、confirm/undo button を統合する。
7. contract tests と preview smoke を更新し、`pnpm check` が通るまで修正する。

## ADR impact
- ADR required: yes
- ADR: 0010
- Why: write/undo route contract、owner/billing gate、snapshot/result truth、latest rollbackable write lookup が新しい source-of-truth になるため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- write/undo domain・worker・route contract tests
- preview shell smoke list

## Risks / open questions
- write result summary の母数は preview rows 全体でなく write 対象 rows 全体に固定する。
- repeated confirm の deny は `previewJobId` 単位で、`previewDigest` 単位 cross-job dedupe は行わない。
- undo conflict 判定は changed-fields-only semantics に固定し、write が触っていない managed field の drift は conflict に含めない。
