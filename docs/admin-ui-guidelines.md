---
doc_type: guideline
authority: supporting
truth_sources:
  - adr/0022-polaris-admin-ui-baseline-and-conventions.md
  - .agents/skills/polaris-admin-ui/SKILL.md
  - tests/contracts/admin-ui-conventions.contract.test.mjs
---

# 管理画面 UI ガイドライン

埋め込み管理画面 UI（`app/routes/app.*`、`app/routes/auth.login.tsx`）の品質規約。規約の決定は ADR-0022、エージェント向け要約は `.agents/skills/polaris-admin-ui/SKILL.md`、機械検証は `tests/contracts/admin-ui-conventions.contract.test.mjs` を正とする。

## 適用範囲

- 対象: merchant が触るすべての画面（埋め込み `/app/*` と補助経路 `/auth/login`）。
- 対象外: webhook / API route（UI を持たない）。

## 画面骨格

```tsx
<div data-testid="example-shell">
  <Page title="画面名">
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">見出し</Text>
            {/* 本文 */}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  </Page>
</div>
```

- 間隔・色は Polaris token のみ。インライン `style` / hex 直書きは contract で禁止される。
- 生 HTML コントロール（button / input / select / table / h1-h6）は使わず Polaris コンポーネントを使う。

## 必須 UI 状態の実装パターン

### loading

```tsx
{refreshFetcher.state !== "idle" ? (
  <SkeletonBodyText lines={3} />
) : (
  /* 取得済みコンテンツ */
)}
```

実行ボタンは `loading` / `disabled` を fetcher 状態に連動させる。

### empty

一覧が空のときは `EmptyState` を出し、次の行動への CTA を必ず付ける。

### error

loader / fetcher の失敗で画面を白くしない。loader 側で graceful degradation し、`Banner` で表示する:

```tsx
{!entitlement ? (
  <div data-testid="home-entitlement-error">
    <Banner tone="critical" title="状態を取得できませんでした">
      <p>時間をおいて再読み込みしてください。</p>
    </Banner>
  </div>
) : null}
```

認証の redirect（`Response` throw）は握りつぶさず再 throw する。

### feedback

mutation 完了は fetcher の結果反映・Banner・ラベル切替のいずれかで明示する。

## コピー集約

- merchant 向け文言は `app/utils/admin-copy.ts` に置く。
- entitlement 状態の表示は `getEntitlementStateLabel(state)` を経由する（pricing / welcome / home で共通）。

## data-testid とテスト容易性

| 種別 | 命名 | 例 |
| --- | --- | --- |
| 画面ルート | `<route>-shell` | `app-shell`, `pricing-shell`, `login-shell` |
| 状態ゲート | `<route>-gate-<state>` | `pricing-gate-active` |
| 行動導線 | `<feature>-cta` | `pricing-plan-selection-cta` |
| エラー表示 | `<feature>-error` | `home-entitlement-error` |

smoke（`tests/smoke/`）は shell testid に依存する。既存 testid の変更は smoke 更新を伴う。

## 参照実装

`app/routes/app._index.tsx` が正本。次を実演する:

- loader の service 委譲（`loadAppHome`、guardrails 準拠）
- entitlement 状態サマリー（Badge + `getEntitlementStateLabel`）
- `/app/billing/refresh` を `useFetcher` で叩く再確認ボタン（loading 実演）
- entitlement 取得失敗時の `Banner`（error 実演）
- セットアップガイド（次の行動への導線）

## 機械検証ルール対応表

| ルール | 内容 | 検証 |
| --- | --- | --- |
| R1 | インライン style 禁止 | admin-ui-conventions contract |
| R2 | hex カラー直書き禁止 | 同上 |
| R3 | UI route の生 HTML コントロール禁止 | 同上 |
| R4 | shell testid 必須 | 同上 |
| R5 | entitlement 表示は admin-copy 経由 | 同上 |
| R6 | 参照実装が loading / error / fetcher を実演 | 同上 |
| R7 | PolarisProvider は app.tsx / auth.login.tsx のみ | 同上 |
| R8 | skill / 本書の存在と要点 | 同上 |

empty state の網羅やコピーの完全集約は機械検証できないため、レビューと skill の規範で担保する。

## 規約変更手順

1. ADR-0022 を更新（または supersede）する。
2. 本書と `.agents/skills/polaris-admin-ui/SKILL.md` を同一コミットで更新する。
3. `tests/contracts/admin-ui-conventions.contract.test.mjs` を規約に合わせて更新する。
