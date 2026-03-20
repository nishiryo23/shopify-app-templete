# Reviewer Packet

## Purpose
Shopify reviewer と dev store dry run の両方で、同一の経路を再現できるようにする。

## Review metadata snapshot
- Support email: `UNCONFIGURED_BEFORE_SUBMISSION`
- Submission contact email: `UNCONFIGURED_BEFORE_SUBMISSION`
- Privacy policy URL: `UNCONFIGURED_BEFORE_SUBMISSION`
- Reviewer / dev store: `UNCONFIGURED_BEFORE_SUBMISSION`
- Dry-run date: `UNCONFIGURED_BEFORE_SUBMISSION`
- Verified by: `UNCONFIGURED_BEFORE_SUBMISSION`

## Required URLs
- `SMOKE_INSTALL_URL`
- `SMOKE_REINSTALL_URL`
- `SMOKE_EMBEDDED_APP_URL`
- `SMOKE_PRICING_URL`
- `SMOKE_INVALID_SESSION_XHR_URL`
- `SMOKE_INVALID_SESSION_DOCUMENT_URL`
- `SMOKE_STORAGE_STATE_PATH` when reviewer/admin URLs are used for embedded, pricing, or invalid-session document smoke

## Reviewer path
1. Open `SMOKE_INSTALL_URL` and confirm the initial install entry renders.
2. Open `SMOKE_REINSTALL_URL` and confirm the reinstall entry renders.
3. Open `SMOKE_EMBEDDED_APP_URL` inside Shopify admin and confirm `/app` renders fatal-free in the embedded iframe.
4. Open `SMOKE_PRICING_URL` inside Shopify admin and confirm `/app/pricing` renders in the embedded iframe.
5. Call `SMOKE_INVALID_SESSION_XHR_URL` and confirm `401` plus `x-shopify-retry-invalid-session-request: 1`.
6. Open `SMOKE_INVALID_SESSION_DOCUMENT_URL` and confirm the document request bounces to auth/install.

## Reviewer notes
- reviewer path は `docs/dev-store-smoke-checklist.md` の manual checklist と一致させる。
- embedded / pricing / invalid-session document で Shopify admin reviewer URL を使う場合は、Shopify admin にログイン済みの `SMOKE_STORAGE_STATE_PATH` を使う。
- beta-only 機能を reviewer store に見せる場合は、この packet に明記する。

## Dry-run evidence
- Last smoke command: `pnpm run test:smoke`
- Last contract/build gate: `pnpm check`
- Submission is blocked until every `UNCONFIGURED_BEFORE_SUBMISSION` value is replaced and the latest dry run result is recorded here.
