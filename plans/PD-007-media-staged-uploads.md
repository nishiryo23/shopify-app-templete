# PD-007 plan

## Goal
product media の export / preview / write / verify を product-media-v1 プロファイルとして追加する。
media write は外部 URL ベースの `productCreateMedia` mutation を使用する。

## Read first
- `tickets/product-domain/PD-007-media-staged-uploads.md`
- `docs/shopify_app_technical_spec_complete.md` (Section 4.4 Media)
- `.agents/skills/product-domain-parity/SKILL.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`

## Constraints
- launch v1 scope: product-level media (image URL / alt text)
- `shopify.app.toml`、scope、billing truth、webhook policy は変更しない
- write success truth は final-state verification
- DAM / file management は対象外

## Steps
1. `domain/products/export-profile.mjs` に `PRODUCT_MEDIA_EXPORT_PROFILE` と `PRODUCT_MEDIA_EXPORT_HEADERS` を追加
2. `domain/media/export-csv.mjs` を作成 — media row を CSV に serialize
3. `platform/shopify/product-media.server.mjs` を作成 — media 読み出し + write mutation
4. `domain/media/preview-csv.mjs` を作成 — CSV parse、diff、preview row 構築
5. `domain/media/write-rows.mjs` を作成 — mutation input builder + verification
6. `workers/product-write-media.mjs` を作成 — write worker
7. `workers/product-export.mjs` に media profile を追加
8. `workers/product-preview.mjs` に media profile を追加
9. `workers/product-write.mjs` に media profile dispatch を追加
10. ADR-0014 作成 — media profile and write contract
11. contract test 追加
12. `pnpm check` で検証

## ADR impact
- ADR required: yes
- ADR: 0014
- Why: product media write の route contract (staged upload vs external URL, media association mutation)

## Validation
- `pnpm run test:contracts`
- `pnpm check`

## Risks / open questions
- staged upload vs external URL: launch v1 では external URL ベースの `productCreateMedia` に限定し、staged upload は将来対応とする
- media position ordering の write/verify 精度
- 動画/3D model は launch v1 scope 外（IMAGE のみ）
