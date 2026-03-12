# Dev Store Smoke Checklist

## Purpose
Shopify App Store reviewer と dev store で、launch-critical path を短時間で再現するための checklist。

## Preconditions
- reviewer/dev store が作成済み
- install / reinstall / embedded shell / pricing shell / invalid-session path の各 URL が有効
- Playwright 実行時の環境変数を設定済み

## Required environment variables
- `SMOKE_INSTALL_URL`
- `SMOKE_REINSTALL_URL`
- `SMOKE_EMBEDDED_APP_URL`
- `SMOKE_PRICING_URL`
- `SMOKE_INVALID_SESSION_XHR_URL`
- `SMOKE_INVALID_SESSION_DOCUMENT_URL`
- `SMOKE_STORAGE_STATE_PATH`（`SMOKE_EMBEDDED_APP_URL`、`SMOKE_PRICING_URL`、`SMOKE_INVALID_SESSION_DOCUMENT_URL` のいずれかに Shopify admin reviewer URL を使う場合は必須）

`SMOKE_EMBEDDED_APP_URL` と `SMOKE_PRICING_URL` は Shopify admin reviewer URL を優先する。`SMOKE_INVALID_SESSION_DOCUMENT_URL` も admin/reviewer URL を使うなら同じ扱いにする。admin/reviewer URL を自動実行するときは、Shopify admin へログイン済みの Playwright `storageState` を `SMOKE_STORAGE_STATE_PATH` で渡す。`storageState` は embedded shell / pricing shell / invalid-session document smoke にだけ注入し、install / reinstall smoke には注入しない。直接の app URL を入れる場合は `storageState` は任意だが、smoke helper が top-level 描画を同じ総タイムアウト内で待てる状態にしておく。

## Playwright skeleton
```sh
pnpm run test:smoke:list
pnpm run test:smoke
```

`pnpm run test:smoke` は上記 URL が未設定なら fail-fast する。scaffold の一覧確認だけしたいときは `pnpm run test:smoke:list` を使う。
embedded / pricing / invalid-session document のいずれかで admin reviewer URL を使うのに `SMOKE_STORAGE_STATE_PATH` が無い場合も fail-fast する。

## Manual checklist
1. install URL を開き、初回 install の入口が描画される。
2. reinstall URL を開き、再インストール導線の入口が描画される。
3. `/app` を Shopify admin 内で開き、親ページではなく埋め込み iframe 側で app home route が fatal-free に描画される。
4. `/app/pricing` を開き、埋め込み iframe 側で pricing shell が表示される。
5. invalid session の XHR で `401` と `x-shopify-retry-invalid-session-request: 1` が返る。
6. invalid session の document request が auth/install 側へ bounce する。
7. reviewer に案内する URL と手順が上記 smoke path と一致している。

## Notes for reviewer packet
- reviewer path は install -> reinstall -> Shopify admin 内の `/app` iframe -> Shopify admin 内の `/app/pricing` iframe -> invalid session retry path の順で案内する。
- embedded smoke は reviewer/admin URL を優先し、iframe 内 route の描画を確認する。automation では direct app URL を使う場合もあるが、その場合も shell 描画完了を確認して false failure にしない。
- reviewer/admin URL を automation で使う場合は、reviewer/dev store の Shopify admin にログイン済みな browser state を別途採取し、`SMOKE_STORAGE_STATE_PATH` で渡す。
- Playwright の browser state は `playwright/.auth/` など repo で ignore される場所に保存し、admin cookie を commit しない。
- beta-only 機能を reviewer store に見せる場合は明記する。
- install / reinstall / pricing path を未確認のまま提出しない。
