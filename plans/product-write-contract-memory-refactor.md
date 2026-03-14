# product-write-contract-memory-refactor plan

## Goal
`product-write` 契約テストの目的を変えずに、worker 契約テスト実行時の不要な依存読み込みを減らし、Node のメモリ圧迫を抑える。

## Read first
- `.agents/skills/product-domain-parity/SKILL.md`
- `.agent/PLANS.md`
- `tests/contracts/product-write.contract.test.mjs`
- `workers/product-write.mjs`
- `workers/product-undo.mjs`

## Constraints
- `product write` / `undo` の契約意味は変えない
- Shopify 本番経路のデフォルト依存解決は維持する
- launch scope 外の Orders / Customers / Discounts には触れない

## Steps
1. worker のトップレベル import で読み込んでいる重い依存を遅延解決に置き換える
2. 契約テストで worker を必要なケースだけ import し、不要な初期化を避ける
3. `test:contracts` と `pnpm check` を実行して回帰確認する

## ADR impact
- ADR required: no
- ADR: none
- Why: architecture や truth source は変えず、テスト実行時の依存解決方法を局所改善するだけのため

## Validation
- `pnpm run test:contracts`
- `pnpm check`

## Risks / open questions
- 実行時間は改善しても、別の重いテストが残る可能性はある
- lazy import 化で例外メッセージのタイミングが変わらないかはテストで確認する
