---
name: polaris-admin-ui
description: Use when adding or changing embedded admin UI in app/routes/app.* or auth.login; defines Polaris layout, required UI states, copy, and data-testid conventions.
---

# Polaris admin UI

## Truth

- UI baseline は Polaris React v13（ADR-0022）。`s-*` web components へは移行しない（将来 ticket）。
- `PolarisProvider` を持てるのは `app/routes/app.tsx`（埋め込み shell）と `app/routes/auth.login.tsx`（埋め込み外）のみ。
- route は `domain/` を直接 import しない。loader / action は `app/services/` へ委譲する（既存 guardrails に従う）。
- 参照実装は `app/routes/app._index.tsx`。新しい画面を作る前に必ず読む。
- 機械検証は `tests/contracts/admin-ui-conventions.contract.test.mjs`。規約を変えるときは ADR-0022 を更新する。

## 画面骨格

- `Page > Layout > Layout.Section > Card > BlockStack` を基本とする。
- 間隔は Polaris token（`gap="400"` 等）のみ。インライン `style` と hex カラー直書きは禁止。
- 生 HTML コントロール（`<button>` `<input>` `<select>` `<table>` `<h1>`-`<h6>`）は使わない。Polaris の `Button` / `TextField` / `Text as="h2"` 等を使う。
- 画面のルート要素に `data-testid="<route>-shell"` を付ける（smoke が依存する）。

## 必須 UI 状態（4 状態）

UI を伴う変更は、適用可能な限り次を実装する:

1. **loading** — 取得中は `SkeletonBodyText` / `SkeletonPage`、実行中の `Button` は `loading` か `disabled`。
2. **empty** — 一覧が空のときは `EmptyState`（次の行動への CTA 付き）。
3. **error** — 失敗は `Banner tone="critical"` で表示し、画面を白くしない。loader はクラッシュさせず graceful degradation する（参照実装の `loadAppHome` 参照）。
4. **feedback** — mutation 完了は fetcher の状態反映や Banner で明示する。「押しても何も起きない」を作らない。

## コピー規約

- merchant 向け文言は `app/utils/admin-copy.ts` に集約する。route に文字列リテラルを散らかさない。
- entitlement 状態の表示は `getEntitlementStateLabel` を経由する。
- 文言は日本語。raw state code の併記は admin-copy 側の `includeCode` オプションで制御する。

## data-testid 命名

- 画面ルート: `<route>-shell`（例: `app-shell`, `pricing-shell`, `login-shell`）
- 状態ゲート: `<route>-gate-<state>`（例: `pricing-gate-active`）
- 行動導線: `<feature>-cta`（例: `pricing-plan-selection-cta`）
- エラー表示: `<feature>-error`（例: `home-entitlement-error`）

## a11y

- 見出しは `Text as="h2" variant="headingMd"` 等で文書構造を保つ。
- エラーは `Banner`（role が付与される）か `role="alert"` 相当で通知する。
- アイコンのみの Button には `accessibilityLabel` を付ける。

## Verification

- `node --test tests/contracts/admin-ui-conventions.contract.test.mjs`
- `pnpm check`
- 画面追加時は smoke（`tests/smoke/`）の shell testid 検証と整合させる。
