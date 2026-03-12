# ADR-0004 App-specific HTTPS webhooks only

- Status: Accepted

## Context
v1 は fixed topics だけで十分であり、運用の複雑性を増やしたくない。

## Decision
- v1 は app-specific webhooks only
- delivery method は HTTPS only
- compliance topics は TOML だけで管理
- webhook truth は HMAC valid + durably enqueued inbox event
- webhook inbox dedupe truth は `X-Shopify-Event-Id` を基準にしつつ、subscription 識別子単位で判定する
- `X-Shopify-Webhook-Id` を第一、`X-Shopify-Name` を第二の subscription 識別子として使い、同一 subscription 内 retry のみ no-op にする

## Consequences
registration drift が減り、public app review に合わせやすい。
