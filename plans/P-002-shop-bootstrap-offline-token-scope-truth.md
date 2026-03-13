# P-002 shop bootstrap, offline token, scope truth plan

## Goal
install / reinstall 後の bootstrap と、encrypted offline token 保存と、query-based scope truth を確立する。

## Read first
- `tickets/platform/P-002-shop-bootstrap-offline-token-scope-truth.md`
- `docs/shopify_app_technical_spec_complete.md`
- `.agents/skills/shopify-lifecycle/SKILL.md`
- `adr/0002-embedded-auth-and-token-exchange.md`
- `adr/0004-app-specific-https-webhooks-only.md`

## Constraints
- managed install + token exchange を前提にする
- `expiringOfflineAccessTokens: true` は維持する
- offline token は平文で永続化しない
- granted scopes truth は `currentAppInstallation.accessScopes`
- pricing gate / billing mapping / full webhook lifecycle には広げない

## Steps
1. `Shop` model と encrypted offline session 保存を追加する
2. online/offline を分離する custom session storage を入れる
3. 認証済み admin boundary の bootstrap で `currentAppInstallation.accessScopes` を query して `Shop` snapshot を更新する
4. `app/scopes_update` を payload-based sync から re-query trigger へ変更する
5. uninstall cleanup を `Shop` row まで広げる
6. contract / integration 相当の test と `pnpm check` で検証する

## ADR impact
- ADR required: yes
- ADR: 0002, 0004
- Why: offline token bootstrap と scope/webhook lifecycle truth の両方を更新するため。

## Validation
- `pnpm check`
- reinstall smoke
- encrypted offline session の復元テスト

## Risks / open questions
- expiring offline token refresh は bootstrap hook ではなく offline `storeSession` 側で吸収する
- `Shop.grantedScopes` は snapshot であり、truth は query helper に残す
