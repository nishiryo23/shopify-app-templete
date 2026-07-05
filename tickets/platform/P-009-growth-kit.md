# P-009 Growth Kit v1（配布・収益化装置）

> テンプレ本体に実装する platform ticket（fork 時ではない）。実行時は `plans/P-009-growth-kit.md` を作ってから進める。
> ADR 必須（新規 state machine・route contract・retention/privacy 境界を含むため）。実装前に ADR を作成し、change summary に ADR 番号を残す。

## Objective

(a) レビュー依頼 (b) オンボーディングチェックリスト (c) ファネル計測 (d) アンインストール計測 (e) リスティング資産、の 5 装置をテンプレ標準にする。
背景: 2026-07 のテンプレレビューで、テンプレ・派生 7 repo すべてにこの 5 装置が存在しないことを確認（事業診断の敗因「配布装置なし」の構造的再生産）。

## Read first

- `docs/app-store-listing-assets.md`（(e) は本 doc で完了済み）
- Shopify レビュー依頼ポリシー: https://shopify.dev/docs/apps/launch/marketing/manage-app-reviews
- `docs/template_scope.md` / `adr/`（entitlement state machine と route contract の既存判断）
- `domain/retention/policy.mjs` / `domain/telemetry/`（保持期間・偽名化の既存境界。本 ticket のデータ境界はこれに揃える）

## Checklist

### (c) ファネル計測 — 最初に作る（他装置の計測基盤）

- [ ] `FunnelEvent` テーブル（shop / event / occurredAt / metadata）。イベント語彙:
      `installed` / `onboarding_step_completed` / `activated`（アプリ定義の初回価値行動）/
      `plan_selection_viewed` / `subscription_active` / `uninstalled`
- [ ] `metadata` は ADR で定めた **allowlist スキーマのみ**許可する（自由形式 JSON を禁止）。**顧客 PII（氏名・メール・電話・住所）は保存しない**
- [ ] 記録ヘルパーを `domain/growth/funnel.server.ts` に置き、auth bootstrap / welcome gate / uninstall webhook から発火
- [ ] 週次で数字を出す簡易クエリ（または開発者向け内部ルート）

### データ境界（privacy / retention）— 実装前に ADR で確定する

- [ ] `FunnelEvent` の保持期間（日数）を定め、`domain/retention/policy.mjs` の sweep 対象に追加する
- [ ] `eraseShopData`（shop/redact）の削除対象に `FunnelEvent` を追加する。uninstall 後スナップショットを分析用に残す場合は、shop に紐づかない匿名化レコードへ変換する（残す/残さないの判断自体を ADR に記録）
- [ ] shop 識別子以外を保存する場合は `TELEMETRY_PSEUDONYM_KEY` による既存の偽名化方針に従う
- [ ] metadata allowlist・保持期間・削除経路を contract test 化する

### 収束レビュー後の root-cause 不変条件

- onboarding / activated の idempotency は `createMany({ skipDuplicates: true })` と条件付き `updateMany` で実装し、interactive transaction 内で unique violation を catch して続行しない。
- `TelemetryPseudonymKeyFingerprint` 行が欠落し、かつ既存 `FunnelEvent` が 1 件でもある場合は、現在キーを正本化せず consistency error で fail-fast する。復旧は旧 `TELEMETRY_PSEUDONYM_KEY` と fingerprint 行の復元、または全 `FunnelEvent.shopHash` の削除/再書き換え migration を明示してから fingerprint を再作成する。
- `app/uninstalled` は snapshot 記録と raw growth cleanup を分離する。snapshot insert / shopHash 解決 / fingerprint mismatch が失敗しても `OnboardingProgress`、`GrowthState`、`ReviewRequestState` cleanup と webhook processed を進める。

### (b) オンボーディングチェックリスト

- [ ] ステップ定義レジストリ（id / タイトル / 完了判定 fn）＋ `OnboardingProgress` 永続化
- [ ] `app._index` の静的 List を置き換えるチェックリスト Card（完了時に funnel イベント発火）

### (a) レビュー依頼（ポリシー制約が実装要件）

- [ ] 発火条件: `activated` 済み・インストールから一定期間経過・課金中など「価値実感後」のみ。**オンボーディング中は表示禁止**
- [ ] 中立文言のみ（肯定的レビューの要求・インセンティブ提供は禁止）、「今後表示しない」を必ず提供
- [ ] 表示状態（askedAt / dismissed）を Shop 単位で永続化し、再表示間隔を制御
- [ ] admin UI extensions / checkout での依頼は実装しない（ポリシー禁止）

### (d) アンインストール計測

- [ ] `app/uninstalled` 受信時に、在籍期間・最終 entitlement 状態・オンボーディング完了率のスナップショットを funnel metadata へ記録する。
      記録内容は「データ境界」節の匿名化・削除方針に従う
      （注: アンインストール後の UI 表示は不可能。メールアンケートは同意なし送信が禁止のため自動化しない）

## Out of scope

- 外部アナリティクス SaaS 連携 / メール配信基盤
- 派生 repo への遡及適用（各 repo の ticket で行う）
- Orders / Customers / Discounts スコープの追加（本 ticket は既存スコープのままで完結する）

## ADR impact

- funnel イベント語彙・metadata allowlist・保持期間/削除経路（shop/redact・uninstall との関係）を新規 ADR に記録
- レビュー依頼の表示条件 state machine を新規 ADR に記録

## Acceptance

- fork 直後のアプリで 5 装置が「設定差し替えのみ」で有効化でき、`pnpm check` が通る
- guardrails（route→domain 直 import 禁止等）に適合している
- shop/redact 実行後に当該 shop の `FunnelEvent` が残らないことが contract test で検証される

## Validation

- `pnpm check`
- 新規 contract test（funnel イベント語彙・metadata allowlist・保持/削除・レビュー依頼条件の全分岐）
