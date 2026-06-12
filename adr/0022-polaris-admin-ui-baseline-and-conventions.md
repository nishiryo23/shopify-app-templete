# ADR-0022 Polaris admin UI baseline and conventions

- Status: Accepted
- Date: 2026-06-12
- Owners: template maintainers

## Context

テンプレートの目標は「Shopify 公式ドキュメントに準拠しつつ、質の高い管理画面 UI をエージェントが実装できること」だが、これまで UI 品質を担保する truth source が存在しなかった。backend / platform はガードレールと contract test で機械検証される一方、UI はプレースホルダのままで、エージェントが倣う正本も規約もなかった。

また Shopify は公式テンプレートを Polaris web components へ移行させつつあり、UI 技術の baseline を明示的に固定しないと、生成される UI が画面ごとに分裂するリスクがある。

## Decision

- 埋め込み管理画面 UI の baseline は **Polaris React v13** に固定する。
- `PolarisProvider`（`@shopify/polaris` の `AppProvider`）を持てる route は次の 2 つのみとする:
  - `app/routes/app.tsx`（埋め込み shell）
  - `app/routes/auth.login.tsx`（埋め込み外のスタンドアロン補助経路）
- UI 規約の正本は `.agents/skills/polaris-admin-ui/SKILL.md` と `docs/admin-ui-guidelines.md` に置き、機械検証は `tests/contracts/admin-ui-conventions.contract.test.mjs` で行う。
- 参照実装は `/app` ホーム（`app/routes/app._index.tsx`）とする。entitlement 状態サマリー・loading（Skeleton）・error（Banner）・mutation feedback（fetcher）を実演する。
- 機械検証する規約:
  - インライン `style` / hex カラー直書きの禁止
  - UI route での生 HTML コントロール（button / input / select / table / h1-h6）の禁止
  - UI route ごとの shell `data-testid` 必須
  - entitlement 表示は `app/utils/admin-copy.ts` の `getEntitlementStateLabel` 経由
- 規約の変更は本 ADR の更新を伴う。

## Consequences

- 得られるもの: エージェントが UI を生成する際の正本と機械検証。画面間の一貫性。smoke / contract が依存する testid 規約の固定。
- 失うもの: Polaris web components の新機能への即時追従。route 内の自由なスタイリング。
- 後続タスク: Polaris web components への移行は将来の ticket + 本 ADR の supersede で行う。i18n（en/ja 切替）方針は別 ADR で判断する。

## Alternatives considered

- **Polaris web components（`s-*`）へ移行**: Shopify 公式テンプレの現行方向だが、既存画面・contract test・skill の全面書き換えになり、本 ticket のスコープを大きく超える。将来 ticket として残す。
- **規約を docs のみに置き contract を作らない**: 既存ハーネスの「長文説明より truth source」という原則（ADR-0001）に反するため不採用。

## References

- `tickets/harness/H-016-admin-ui-quality-harness.md`
- `.agents/skills/polaris-admin-ui/SKILL.md`
- `docs/admin-ui-guidelines.md`
- `tests/contracts/admin-ui-conventions.contract.test.mjs`
- ADR-0001（repo truth）, ADR-0003（pricing/welcome の表示規律）
