# ADR-0004 App-specific HTTPS webhooks only

- Status: Accepted

## Context
v1 は fixed topics だけで十分であり、運用の複雑性を増やしたくない。

## Decision
- v1 は app-specific webhooks only
- delivery method は HTTPS only
- compliance topics は TOML だけで管理
- Shopify CLI の `webhooks_path` は個別 endpoint ではなく、対象 webhook 群を束ねる共通 prefix を truth にする
- webhook truth は HMAC valid + durably enqueued inbox event
- durable inbox は retry / replay を観測できる永続ストアに保存し、route handler は enqueue 前に side effect を行わない
- duplicate delivery は inbox の `processed` 状態を見て判定し、未処理 duplicate を永久 no-op にしない
- webhook inbox dedupe truth は `X-Shopify-Event-Id` を基準にしつつ、subscription 識別子単位で判定する
- `X-Shopify-Webhook-Id` を第一、`X-Shopify-Name` を第二の subscription 識別子として使い、同一 subscription 内 retry のみ no-op にする
- `app/scopes_update` で session 上の scope を同期する場合は、単一 session id ではなく shop 単位の全 session を更新する

## Consequences
registration drift が減り、public app review に合わせやすい。
