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
- `SHOP_TOKEN_ENCRYPTION_KEY` が有効な shop では offline session を app-owned encrypted shop state のみへ保存し、legacy Session row の plaintext token は即時削除する
- offline session 削除は `Shop` row 自体を消さず、encrypted payload と session id だけを null 化して bootstrap state を保持する
- unreadable な encrypted offline session は cache miss として破棄し、token exchange で自己回復させる
- granted scopes truth は `currentAppInstallation.accessScopes` query に置く
- direct API access は使わない
- minimal launch scaffold は Shopify React Router app template をベースにする
- `shopify.app.toml` の redirect URL は React Router auth boundary と一致させ、`/auth/callback` を truth とする
- Shopify app home (`/`) は preview / app launch の entry とし、受けた query string を保持したまま `/app` へ即時 redirect する
- `/auth/login` は `shopify.login` を使う login page とし、`GET`/`POST` を受ける一方で `HEAD` は form parse を起こさない no-op にして preview/auth probe で 500 を出さない
- `/app`, `/app/pricing`, `/app/welcome` は embedded shell と `authenticate.admin` 境界を持つ
- invalid XHR は retry header 付き 401、invalid document は auth/install 側へ bounce する contract を守る

## Consequences

auth boundary が明確になり、review-safe になる。
