# PD-008 Product metafields and SEO plan

## Goal
`product-metafields-v1` profile を追加し、product metafields の export / preview / write / verify を既存 pipeline に統合する。SEO は既存 `product-core-seo-v1` contract を維持し、regression を防ぐ。

## Read first
- `tickets/product-domain/PD-008-product-metafields-and-seo.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract は変更しない。
- `PD-008` は product metafields のみ。SEO は既存 contract の regression 固定とする。
- launch v1 の metafields scope は product owner の全 namespace を対象にするが、supported type subset のみ扱う。
- supported type は `single_line_text_field`、`multi_line_text_field`、`boolean`、`number_integer`、`number_decimal` に固定する。
- blank value と row removal による delete/clear は launch v1 では扱わない。
- undo は `product-core-seo-v1` のみ維持し、`product-metafields-v1` では提供しない。

## Steps
1. `adr/0015-product-metafields-profile-and-write-contract.md` を追加し、profile、CSV header、supported type、explicit type create、no-delete、pagination read、warning metadata を固定する。
2. requirements / technical spec を更新し、launch metafields scope と unsupported type / delete 非対応を明文化する。
3. `domain/products/export-profile.mjs` に `product-metafields-v1` を追加し、`domain/metafields` の export / preview / write helper を実装する。
4. `platform/shopify/product-metafields.server.mjs` を追加し、product metafields の export/read と `metafieldsSet` write を実装する。
5. export / preview / write workers と preview UI selector を更新し、`product-metafields-v1` の dispatch を追加する。
6. contract tests を追加し、`pnpm check` が通るまで修正する。

## ADR impact
- ADR required: yes
- ADR: 0015
- Why: product metafields profile、CSV contract、supported type subset、explicit type create、`metafieldsSet` write contract が新しい source-of-truth になるため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- product export / preview / write contract tests
- preview shell profile selector assertion

## Risks / open questions
- unsupported type を export 対象外にするため、warning metadata と docs を必ず揃える。
- multiline / decimal canonical compare が甘いと verify 偽陽性が出るため、helper と tests で固定する。
- 将来 JSON や delete semantics を追加する場合は profile version を切る。
