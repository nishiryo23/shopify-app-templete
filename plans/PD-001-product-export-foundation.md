# PD-001 Product export foundation plan

## Goal
Product Domain Parity MVP の最初の export contract を実装し、embedded app から product core + SEO の CSV export job を作成して worker が artifact と manifest を生成できる状態にする。

## Read first
- `tickets/product-domain/PD-001-product-export-foundation.md`
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `adr/0005-product-domain-parity-mvp-boundary.md`
- `.agents/skills/product-domain-parity/SKILL.md`
- `.agents/skills/adr-discipline/SKILL.md`

## Constraints
- `shopify.app.toml`、scope、billing truth、webhook policy は変更しない。
- PD-001 では preview / write / undo / export history UI を実装しない。
- export profile は `product-core-seo-v1` に固定し、後続 ticket は別 profile か version 追加で拡張する。
- manifest は新テーブルでなく private artifact として保存し、artifact metadata の二重管理をしない。
- worker は `unauthenticated.admin(shop)` を使う。offline session 不在は retry loop にせず terminal failure とする。
- worker は long-running export 中に lease heartbeat を継続し、Shopify page fetch の境界ごとに lease を確認する。source CSV は temp file へ page-at-a-time で書き出し、lease 喪失後は artifact side effect を fence する。shutdown 時は in-flight job の finalization 後に disconnect する。

## Steps
1. `adr/0008-product-export-route-and-artifact-contract.md` を追加し、export route contract、artifact truth、offline session failure policy を固定する。
2. `POST /app/product-exports` と service 層を追加し、active job lookup と enqueue を実装する。
3. Shopify product reader、canonical row mapper、CSV serializer、manifest builder を追加する。
4. artifact storage factory と最小 S3 adapter を追加し、source/manifest artifact 保存と補償 delete を実装する。
5. worker dispatcher を追加し、`product.export` の lease / run / complete / fail を実装する。source CSV は全件配列を保持せず temp file へ逐次書き出す。
6. worker 実行中の heartbeat 維持と graceful shutdown の順序を contract test で固定する。
7. contract / integration-style tests を追加し、`pnpm check` が通るまで修正する。

## ADR impact
- ADR required: yes
- ADR: 0008
- Why: route contract、artifact truth、offline session failure policy が新しい source-of-truth になるため。

## Validation
- `pnpm run test:contracts`
- `pnpm check`
- export job route と worker の contract test
- S3 adapter / artifact compensation の smoke 相当 test

## Risks / open questions
- 現行 queue は shop 単位 lease を持つため、export も基盤上は同一 shop の他 job と直列になる。この ticket では queue truth 自体は変更しない。
- active export dedupe は DB の active unique index を正本にし、service 層は duplicate enqueue 後に既存 active job を lookup して返す。
- duplicate enqueue の直後に active job が terminal へ遷移していて active job が見えない場合は accepted response に使わず、enqueue failure として扱う。
- `product-core-seo-v1` は product core + SEO の固定 profile であり、variants / inventory / media は後続 ticket で別 profile か version 追加にする。
- storage contract は backend 間で揃え、S3 structured read でも descriptor metadata を保持する。
- export reader は cursor pagination を page 単位で処理し、lease 喪失後の追加 Shopify read を止める。
- export 本体成功後の finalize failure は retry/dead-letter へ変換せず、worker 異常として分離する。
