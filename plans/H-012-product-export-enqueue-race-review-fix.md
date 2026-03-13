# H-012 product export enqueue race review fix plan

## Goal
`product.export` の重複 enqueue 競合後でも、新しい export 要求が silently dropped されず、新規 job 作成か active job 返却のどちらかを保証する。

## Root cause
- `enqueue` が unique conflict で失敗した後、active job が `completed` へ遷移すると service は latest completed job を返してしまう
- その結果、HTTP 202 を返しても新しい export job は存在せず、再実行要求が失われる

## Scope
- `domain/products/export-jobs.mjs`
- `app/services/product-exports.server.ts`
- `tests/contracts/product-export.contract.test.mjs`

## Constraints
- route / service boundary は維持する
- conflict 後に completed job を accepted response として返さない
- root cause を直接叩く test を追加する

## Steps
1. conflict 後に active lookup → retry enqueue → active re-check の helper を追加する
2. service から latest completed fallback を除去する
3. duplicate enqueue race では active job 返却か enqueue failure のどちらかに閉じる契約テストを追加する
4. `pnpm check` で標準 gate を通す

## ADR impact
- ADR required: yes
- ADR: 0008
- Why: product export route contract の accepted response 条件を修正するため

## Validation
- `pnpm run test:contracts`
- `pnpm check`
