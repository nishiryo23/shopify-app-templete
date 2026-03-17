# PD-012 Matrixify compatibility subset plan

## Goal
preview import にだけ Matrixify subset 正規化を追加し、export / write / undo の canonical truth は維持する。

## Read first
- `tickets/product-domain/PD-012-matrixify-compatibility-subset.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `adr/0009-product-preview-route-and-provenance-contract.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `app/services/product-previews.server.ts`
- `domain/products/spreadsheet-format.mjs`
- `domain/products/preview-profile.mjs`
- `workers/product-preview.mjs`
- `tests/contracts/product-preview.contract.test.mjs`
- `tests/contracts/product-xlsx.contract.test.mjs`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract は変更しない。
- compatibility は import-only。export は canonical template のまま維持する。
- `sourceFile` は `matrixify` でも必須のままにし、selected export の source artifact と manifest を baseline truth にする。
- write / undo / final-state verification の truth は変更しない。
- Matrixify compatibility は allowed header subset と explicit error に閉じ、destructive semantics は広げない。

## Steps
1. preview payload / artifact metadata / result payload に `sourceFormat`、`editedFormat`、`editedLayout`、`editedRowMapDigest` を追加する。
2. `domain/products/spreadsheet-format.mjs` に canonical / matrixify 共通正規化入口を追加し、Matrixify subset を canonical CSV へ変換する。
3. `app/services/product-previews.server.ts` と `workers/product-preview.mjs` を更新し、source / edited を別 format で canonicalize できるようにする。
4. preview UI に `editedLayout` 切替と source / edited 別の file contract を追加する。
5. contract tests を追加し、Matrixify subset の header / empty-cell / dedupe / row-map ルールを固定する。
6. ADR-0005 / ADR-0009 と docs を更新して compatibility boundary を明文化する。

## ADR impact
- ADR required: yes
- ADR: 0005, 0009
- Why: partial Matrixify-compatible mode の boundary と preview route contract を更新し、source required、allowed headers、row-map-aware dedupe を固定する必要がある。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- Matrixify subset contract tests

## Risks / open questions
- Matrixify の row-number mapping を preview identity に含めるため、dedupe と digest を同時に更新する必要がある。
- `product-manual-collections-v1` の header absent/no-op 行は synthetic unchanged row で扱う想定で、preview pipeline への組み込みを明示実装する。
