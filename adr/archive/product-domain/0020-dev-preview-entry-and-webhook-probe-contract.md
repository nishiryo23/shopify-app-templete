# ADR-0020 Dev preview entry and webhook probe contract

- Status: Accepted

## Context

`shopify app dev` の preview は app home (`/`) から始まる一方、この repo の実 UI は `/app` 配下にある。加えて Shopify CLI は `webhooks_path = "/webhooks/app"` に対して prefix probe を行うため、entry route と webhook prefix route の contract が未固定だと local preview が不安定になる。

## Decision

- app home (`/`) は preview / app launch entry とし、受けた `shop` / `host` / `embedded` などの query string を保持したまま `/app` へ redirect する
- `/auth/login` は `shopify.login` を使う login page とし、`HEAD` probe では form parse を起こさず 200 系で応答する
- `/webhooks/app` は Shopify CLI の prefix probe 専用 route とし、webhook enqueue を行わず 204 を返す
- actual app-specific webhook delivery truth は従来どおり `/webhooks/app/uninstalled` と `/webhooks/app/scopes_update` の durable enqueue に置く

## Consequences

local dev preview の launch path と Shopify CLI probe が repo の route contract と整合する。
