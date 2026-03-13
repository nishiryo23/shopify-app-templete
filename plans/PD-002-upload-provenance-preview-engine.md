# PD-002 Upload, provenance, preview engine plan

## Goal
`PD-001` の export artifact を baseline にした closed-loop preview を追加し、`product-core-seo-v1` の CSV update-only preview を worker と embedded UI から実行できる状態にする。

## Read first
- `tickets/product-domain/PD-002-upload-provenance-preview-engine.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `adr/0007-db-queue-artifact-and-provenance-crypto-truth.md`
- `adr/0008-product-export-route-and-artifact-contract.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy は変更しない。
- `PD-002` は `product-core-seo-v1` の CSV preview のみを対象にし、write / confirm / undo / XLSX は実装しない。
- source provenance verify は `exportJobId + source CSV + manifest artifact` を正本にし、edited CSV 自体は provenance 対象にしない。
- preview は既存 PostgreSQL queue と shop 単位 lease をそのまま使い、queue truth 自体は変更しない。
- preview route は preview を未課金でも許可し、billing gate は `PD-003` に委ねる。

## Steps
1. `adr/0009-product-preview-route-and-provenance-contract.md` を追加し、preview route contract、baseline artifact 有効条件、source provenance truth、offline session failure policy、preview dedupe を固定する。
2. preview profile / dedupe / artifact key / CSV parse / diff / digest の domain module を追加する。
3. `POST /app/product-previews` と `/app/preview` の service/route/UI を追加し、completed export 選択、source/edited upload、preview status/summary の最小画面を実装する。
4. Shopify live read platform module と `product.preview` worker を追加し、source verify、edited parse、live state read、diff、result artifact 保存を実装する。
5. worker bootstrap に preview kind を登録し、offline session 不在時の terminal failure、dedupe race cleanup、summary/read model を統合する。
6. contract tests と preview smoke を追加し、`pnpm check` が通るまで修正する。

## ADR impact
- ADR required: yes
- ADR: 0009
- Why: preview route contract、source provenance truth、preview dedupe、offline session failure policy が新しい source-of-truth になるため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- preview route / worker / read model の contract test
- preview smoke list

## Risks / open questions
- preview は queue 基盤上で同一 shop の export/write 系 job と直列になるが、この ticket では queue truth を変更しない。
- source CSV は export 原本の完全一致を要求するため、merchant が source を保存し直した場合は provenance reject になる。UI copy とエラー文言で明示する。
- edited CSV は provenance 対象ではなく baseline binding 対象であり、`ADR-0009` で ticket 解釈を明文化する。
