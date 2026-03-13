# H-008 offline session storage review fix plan

## Goal
encrypted offline session rollout 中でも offline token を legacy `Session` row に平文で残さず、offline session 削除時に `Shop` state を消さない。

## Root cause
- custom session storage が encrypted offline session を `Shop` に保存しつつ、legacy Prisma session storage を offline write/delete の正本として扱っている
- そのため offline `storeSession` で plaintext token が `Session.accessToken` に残り、offline `deleteSession` で `Shop` row まで削除して bootstrap state を失う

## Scope
- `workers/offline-admin.mjs`
- `app/services/shop-session-storage.server.ts`
- `adr/0002-embedded-auth-and-token-exchange.md`
- `tests/contracts/shopify-config.contract.test.mjs`
- `tests/contracts/product-export.contract.test.mjs`

## Constraints
- managed install + token exchange は維持する
- offline token は平文で永続化しない
- uninstall cleanup だけが `Shop` row 全体を削除する
- root cause を直接叩く test を追加する

## Steps
1. encrypted offline session 有効時は offline session を legacy session table へ保存しない
2. offline session 削除は `Shop.encryptedOfflineSession` と `Shop.offlineSessionId` の null 化に変える
3. worker と app の storage 実装を揃える
4. ADR と contract/runtime test を更新する
5. `pnpm check` で標準 gate を通す

## ADR impact
- ADR required: yes
- ADR: 0002
- Why: offline session persistence truth を dual-write から app-owned encrypted state へ修正するため

## Validation
- `pnpm run test:contracts`
- `pnpm check`
