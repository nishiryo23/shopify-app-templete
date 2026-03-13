# ADR-0002 Embedded auth and token exchange

- Status: Accepted

## Context

public embedded Shopify app は session token + token exchange を前提にする。

## Decision

- managed install
- App Bridge + session token
- request-scope online token
- background-only offline token
- install / reinstall bootstrap は認証済み admin boundary を境界にする
- scope bootstrap failure は auth 成功を巻き戻さない best-effort 扱いにする
- scope bootstrap query は未bootstrap shop と `app/scopes_update` 後の再収束時だけに絞る
- expiring offline token refresh は offline `storeSession` write path で吸収する
- `SHOP_TOKEN_ENCRYPTION_KEY` が設定された shop から順に offline token を app-owned encrypted shop state へ移行する
- 暗号鍵が未設定の環境は既存 Prisma session storage に後方互換フォールバックし、段階 rollout を壊さない
- 暗号化 rollout 中は offline session を encrypted state と legacy Session row の dual-write で保持する
- unreadable な encrypted offline session は cache miss として破棄し、token exchange で自己回復させる
- granted scopes truth は `currentAppInstallation.accessScopes` query に置く
- direct API access は使わない
- minimal launch scaffold は Shopify React Router app template をベースにする
- `shopify.app.toml` の redirect URL は React Router auth boundary と一致させ、`/auth/callback` を truth とする
- `/app`, `/app/pricing`, `/app/welcome` は embedded shell と `authenticate.admin` 境界を持つ
- invalid XHR は retry header 付き 401、invalid document は auth/install 側へ bounce する contract を守る

## Consequences

auth boundary が明確になり、review-safe になる。
