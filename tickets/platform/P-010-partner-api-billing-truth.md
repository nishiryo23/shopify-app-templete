# P-010 Partner API activeSubscription as billing truth

## Objective
2026-04-28 の Shopify 課金プラットフォーム変更（webhook 廃止・Admin API `currentAppInstallation`
deprecated）を受け、entitlement truth を Partner API `activeSubscription(appId, shopId)` へ移行する。
ADR-0003 の旧設計（`currentAppInstallation` truth + webhook trigger）を新設計へ置き換える。

## Background（2026-07-05 時点で shopify.dev 一次情報から確認）
- **2026-04-28 以降、サブスクリプション変更 webhook（`APP_SUBSCRIPTIONS_UPDATE` /
  `app_subscriptions/update`）は送信されない**。ADR-0003 は元々 webhook を trigger only と
  位置づけていたため即座には壊れていないが、trigger 経由の即時 refresh は機能しない。
- Admin API `currentAppInstallation` は **deprecated**（当面動作するが新規実装では非推奨）。
  Shopify 公式ドキュメントに明示的な廃止期限の記載はなく、移行は「推奨」の扱い（強制締切ではない）。
- plan selection 画面からの戻りリダイレクトは `charge_id` ではなく **`plan_handle` + `shop`**
  パラメータになる。
- 出典: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/migrating-to-shopify-app-pricing

## Read first
- `adr/0003-managed-pricing-as-billing-source-of-truth.md`（旧設計。置き換え対象）
- `.agents/skills/billing-entitlement/SKILL.md`
- `app/services/billing.server.ts`（現行 entitlement 参照点）
- `domain/billing/managed-pricing-url.mjs`（plan selection URL 生成）
- 設計参考: `~/project/shopify_receipt_package/launch_plan_2026-07/02_mvp_and_pricing.md` §5-6
  （Partner API activeSubscription・plan handle allowlist・resolver+DBスナップショット+TTL の
  具体設計。本チケットはこの設計をテンプレの構成に合わせて移植する）

## Scope
- Partner API client（`domain/billing/partner-api-client.mjs` 相当）: `activeSubscription(appId, shopId)`
  クエリ。認証情報は Partner API access token（新規 env、`.env.example` に追記）
- entitlement resolver: DB スナップショット + TTL（約10分）方式。TTL 内は DB 読み、TTL 超過で
  Partner API へ refresh、失敗時は直近スナップショットへフォールバック（entitlement 参照が
  主要フローのブロッカーにならないようにする。フォールバック発生はログに記録）
- plan handle allowlist 判定（`ACTIVE` 等のステータス単体ではなく、plan handle が allowlist に
  含まれるかで有料判定する。allowlist は公開プランの handle + `BILLING_TEST_PLAN_HANDLES` env
  でテスト用 handle を追加可能にする）
- `app.welcome.tsx`（または相当route）の戻りリダイレクト処理を `charge_id` から `plan_handle` +
  `shop` パラメータへ更新し、受信時は TTL に関わらず強制 refresh
- `app/services/billing.server.ts` の entitlement 参照点をすべて resolver 経由に統一
- `queryCurrentAppInstallationEntitlement` を削除し Partner API 版へ置き換え（deprecated API を
  残さない）

## Out of scope
- 複数プラン・usage-based billing の追加（既存の単一プラン構成を維持）
- `domain/billing/managed-pricing-url.mjs` の plan selection URL 自体の形式変更（deep link 遷移導線は
  維持。ADR-0003 の P-007 追記部分は本チケットで見直すが、CTA の見た目やコピーは変更しない）
- Partner API access token の発行そのもの（Partner Dashboard 側の作業。ユーザーが事前に用意する）

## ADR impact
`adr/0003-managed-pricing-as-billing-source-of-truth.md` を **旧仕様として明示し**、新設計を
新規 ADR（次番）に記録する。entitlement truth が Partner API query になったこと、resolver の
TTL/フォールバック仕様、plan handle allowlist 方式、強制 refresh のトリガー条件（plan selection
戻りリダイレクトのみ）を決定として残す。

## Acceptance
- entitlement 参照の全参照点（`/app` 系 loader、pricing、welcome、billing refresh action）が
  共通 resolver 経由になっている
- plan handle が allowlist に含まれる場合のみ `ACTIVE_PAID` 相当と判定し、ステータスのみでの
  誤判定がない contract test がある
- Partner API 呼び出し失敗時に直近スナップショットへフォールバックし、フローがブロックされない
  contract test がある
- plan selection 戻りリダイレクトで `plan_handle` + `shop` を受け取った際に強制 refresh される
  contract test がある
- `currentAppInstallation` への参照が residual に残っていない（grep で検出できる形の contract）
- `pnpm check` 全ゲート通過

## Validation
- `node --test tests/contracts/billing-routes.contract.test.mjs`（新規 Partner API resolver 分含む）
- `pnpm check`
- dev store 手動 smoke: plan selection → 戻りリダイレクト → 強制 refresh → `ACTIVE_PAID` 反映
  （`docs/dev-store-smoke-checklist.md`。Partner API access token 設定が前提）
