# ADR-0002 Embedded auth and token exchange

- Status: Accepted

## Context
public embedded Shopify app は session token + token exchange を前提にする。

## Decision
- managed install
- App Bridge + session token
- request-scope online token
- background-only offline token
- direct API access は使わない
- minimal launch scaffold は Shopify React Router app template をベースにする
- `shopify.app.toml` の redirect URL は React Router auth boundary と一致させ、`/auth/callback` を truth とする
- `/app`, `/app/pricing`, `/app/welcome` は embedded shell と `authenticate.admin` 境界を持つ
- invalid XHR は retry header 付き 401、invalid document は auth/install 側へ bounce する contract を守る

## Consequences
auth boundary が明確になり、review-safe になる。
