# Shopify公開アプリ 要件定義書（完全版）
**文書名**: Shopify公開アプリ 要件定義書（完全版）  
**対象**: Public / Embedded Shopify App（Product GA）  
**版**: 1.0  
**状態**: Fixed  
**前提**: Collection workflow は limited beta であり、本書の launch GA 完了条件には含めない

---

## 1. 文書の目的

本書は、対象アプリの**事業要件・業務要件・機能要件・非機能要件・受入条件**を固定し、  
PM / 設計 / 実装 / QA / サポート / App Review 対応の判断基準を一本化するための要件定義書である。

本書は **WHAT を定義する文書**であり、実装方式や使用ライブラリなどの **HOW は技術仕様書へ委譲**する。  
ただし、業務判断・公開アプリ審査・運用安全性に直結する事項は、本書でも明示的に固定する。

---

## 2. 対象アプリの要約

### 2.1 Product thesis
本アプリは、**「日本語の一括更新ツール」ではない**。  
本アプリは、**既存商品の基本情報を、CSVで安全に判断・実行・復旧するための公開アプリ**である。

### 2.2 解く課題
Shopify標準のCSV運用では、次の痛みがある。

- 実行前に「何が変わるか」が十分に見えない
- 一括更新を流したあとに、どの行がどう失敗したかの再作業判断が難しい
- 事故時に「何を戻すか」の判断が遅い
- 日常運用担当にとって英語の高機能アプリは過剰であり、操作責任が曖昧になりやすい

### 2.3 解決の中心価値
価値の中心は「CSVを扱えること」ではなく、次の4点である。

1. **実行前に差分を見て判断できる**
2. **更新対象と意味が狭く明確である**
3. **失敗行だけを日本語で再判断できる**
4. **直前変更を戻せる**

---

## 3. 目的・目標

### 3.1 ビジネス目標
- Shopify App Store に公開可能な public embedded app として launch する
- Product 運用チームが、**Shopify admin 外へ逃げず**に一括更新を完結できるようにする
- 「安全性」で課金根拠を作る

### 3.2 launch v1 の成功条件
- install / reinstall / pricing / uninstall / compliance / preview / write / undo が通る
- Product export / preview / confirm / write / verify / undo が end-to-end で通る
- Shopify App Review の主要 reject 理由が潰れている
- Product workflow が support 可能な透明性を持つ（job history / artifact / audit）

### 3.3 非目標
- Matrixify互換
- 任意CSVの汎用マッピング
- 新規商品作成
- variant / inventory / price / media / metafield 更新
- Orders / Customers / Discounts
- Collection workflow の一般公開GA

---

## 4. スコープ

## 4.1 launch GA in scope
### Product workflow
- 既存商品の export
- 既存商品の update import
- preview
- confirm
- final-state verification
- latest-job undo

### 更新対象フィールド
- `title`
- `status`
- `vendor`
- `productType`
- `tags`

### 安全機能
- closed-loop CSV only
- export manifest
- row fingerprint
- diff preview
- preview expiry
- confirm-time revalidation
- snapshot
- result / error artifact
- job history
- owner-only confirm / undo

### Platform / public app 要件
- public embedded app
- Managed Pricing
- mandatory compliance webhooks
- support email / submission contact email / privacy policy URL
- Shopify managed install 前提

## 4.2 launch GA out of scope
- product create / delete
- handle update
- variants / options / price / inventory / compare-at price
- SEO / body HTML / media / metafields
- Pages / Redirects
- Orders / Customers / Discounts
- optional scopes
- direct Admin API access from frontend
- shop-specific webhooks
- off-platform billing

## 4.3 limited beta（GA完了条件に含めない）
- manual collection membership export / import
- collection beta feature flag
- reviewer store では hidden

---

## 5. ペルソナと関係者

## 5.1 Primary persona
**日本の merchant の商品運用担当 / EC運用担当**

特徴:
- Shopify admin とスプレッドシートは使える
- 一括更新はしたいが、本番事故は避けたい
- 英語の高機能アプリを日常運用チーム全員で安全に使いこなせるとは限らない
- 継続運用（毎週・毎月）で同じ種の更新を繰り返す

## 5.2 Secondary persona
**Shopify Partner / 制作会社の運用担当**

特徴:
- 継続案件の軽微更新を安全に短時間で終えたい
- ただし migration 専用ツールは求めていない

## 5.3 関係者
- Product owner
- Engineering
- QA
- Support
- App Review 対応担当
- Merchant support contact

---

## 6. JTBD

### Functional JTBD
「終売・公開切替・vendor整理・product type整理・タグ整理をするとき、  
**既存商品の基本情報を CSV でまとめて更新したい**。その際、実行前に差分を確認し、失敗行だけ修正し、必要なら直前状態に戻したい。」

### Emotional JTBD
「CSV を流す前に、**何が変わるか分からない不安**をなくしたい。」

### Social JTBD
「変更後に、**誰が・いつ・何件を・何の根拠で変えたか**を説明できるようにしたい。」

---

## 7. 現行業務フローと課題

## 7.1 現行フロー
1. Shopify admin から products を export
2. CSV / spreadsheet で編集
3. 標準 import もしくは他アプリで流す
4. 実行後に storefront / admin を見て結果確認
5. 失敗時は再CSV、または手修正
6. 履歴・理由・直前比較は手元判断になる

## 7.2 課題
- 実行前判断が属人的
- 差分が不透明
- 再作業判断が遅い
- 「壊したくない」が更新スピードを下げる
- 英語高機能アプリは breadth は強いが、責任分界が曖昧になる

## 7.3 To-Be フロー
1. アプリで対象商品を export
2. アプリ専用CSVを編集
3. upload 後に validation + preview
4. preview を見て go / no-go 判断
5. owner が confirm
6. snapshot 取得後に write
7. final-state verification
8. result / error artifact を見て再判断
9. 必要なら latest-job undo

---

## 8. 固定された業務ルール

### 8.1 更新専用
v1 は **既存商品 update 専用** とする。  
新規作成・削除は行わない。

### 8.2 Closed-loop CSV only
v1 は **アプリが export した signed CSV のみ import 可能** とする。  
人手で新規作成した任意CSVは受け付けない。

### 8.3 Product update only
launch GA は **Product workflow only** とする。  
Collection workflow は GA の完了条件に含めない。

### 8.4 owner-only approval
confirm / undo は **store owner only** とする。  
draft 作成や preview 確認は owner 以外でもよい。

### 8.5 write success の定義
write job の成功は、**Shopify 書き込み完了通知ではなく final-state verification 成功**で定義する。

### 8.6 billing truth
billing entitlement の truth は **Shopify query 結果**のみとする。  
welcome link 到達や webhook 到達は trigger であって truth ではない。

---

## 9. 機能要件

## 9.1 Platform / install / lifecycle 要件

### FR-PF-01
本アプリは **public embedded Shopify app** として動作しなければならない。  
**受入基準**: merchant-facing な主要導線が Shopify admin 内で完結する。

### FR-PF-02
install / reinstall の primary flow は **Shopify managed install** でなければならない。  
**受入基準**: manual な `myshopify.com` 入力画面が存在しない。

### FR-PF-03
reinstall は **fresh bootstrap** とし、旧 local state を entitlement truth に使ってはならない。  
**受入基準**: reinstall 後の entitlement は Shopify query で再構築される。

### FR-PF-04
v1 の scope は **`read_products`, `write_products` のみ**でなければならない。  
**受入基準**: install prompt に他 scope が含まれない。

### FR-PF-05
v1 は **optional scopes を持ってはならない**。  
**受入基準**: app config に optional scopes が存在しない。

---

## 9.2 Product export 要件

### FR-EX-01
product export は、指定 filter に一致する **既存商品**のみを対象としなければならない。  
**filter**:
- 全商品
- status
- title / handle 部分一致
- manual collection

### FR-EX-02
export された CSV は、次の provenance columns を必ず含まなければならない。  
- `_schema_version`
- `_resource_type`
- `_shop_domain`
- `_export_job_id`
- `_exported_at`
- `_row_fingerprint`

### FR-EX-03
export CSV は editable business columns と reference / provenance columns を区別しなければならない。  
**受入基準**: reference/provenance columns は preview / import で編集不可として扱われる。

### FR-EX-04
manifest の TTL は **7日**でなければならない。  
**受入基準**: 7日超の CSV は `MANIFEST_EXPIRED` で reject される。

---

## 9.3 Product import / preview 要件

### FR-IM-01
upload された product CSV は、preview 完了前に Shopify へ write を行ってはならない。  
**受入基準**: preview state では product live state が未変更である。

### FR-IM-02
import は signed export artifact に由来する file のみ受け付けなければならない。  
**受入基準**: tampered file が reject される。

### FR-IM-03
CSV で許可される編集は次のみでなければならない。  
- editable columns の値変更
- 列順の並べ替え
- 行削除  
次は拒否する。  
- 行追加
- 未定義列追加
- provenance / metadata columns の編集

### FR-IM-04
preview は次を返さなければならない。  
- 総行数
- changed / unchanged / warning / error 行数
- 行ごとの before / after diff
- row-level error code
- 日本語メッセージ

### FR-IM-05
preview TTL は **30分**でなければならない。  
**受入基準**: 30分超の preview では confirm を受け付けない。

### FR-IM-06
confirm 時には **必ず revalidation** を行わなければならない。  
**受入基準**: preview 後に live state が変わった場合、old preview では write を開始しない。

---

## 9.4 Product update semantics 要件

### FR-UP-01
update の primary key は **商品IDのみ**としなければならない。  
**受入基準**: handle 変更は対象 product の選択に影響しない。

### FR-UP-02
v1 が更新できるのは次の5フィールドのみでなければならない。  
- `title`
- `status`
- `vendor`
- `productType`
- `tags`

### FR-UP-03
blank cell は **変更なし**でなければならない。  
**受入基準**: blank により既存値を消去しない。

### FR-UP-04
明示的な消去は `__CLEAR__` のみ受け付けなければならない。  
**対象**:
- `vendor`
- `productType`
- `tags`

### FR-UP-05
`status` は CSV 上で canonical enum だけを受け付けなければならない。  
**許可値**:
- `ACTIVE`
- `DRAFT`
- `ARCHIVED`
- `UNLISTED`

### FR-UP-06
`tags` は **replace-all only** としなければならない。  
**受入基準**: add/remove semantics を持たず、preview と help 上で全面置換が明示される。

### FR-UP-07
write path は **product-level update** に限定されなければならない。  
**受入基準**: variants / inventory / media / metafields は不変。

---

## 9.5 Confirm / write / verify / undo 要件

### FR-WR-01
confirm は **store owner only** としなければならない。  
**受入基準**: owner 以外は `403` となる。

### FR-WR-02
write 開始前に snapshot を取得しなければならない。  
**受入基準**: snapshot 取得失敗時は write を始めない。

### FR-WR-03
同一 shop では app-owned write job は **同時に1本まで**でなければならない。  
**受入基準**: concurrent write は `409` となる。

### FR-WR-04
write 完了判定は **Shopify 書き込み完了ではなく final-state verification** に基づかなければならない。  
**受入基準**: final-state mismatch がある job は `SUCCESS` にならない。

### FR-WR-05
partial success の場合でも result / error artifact を必ず生成しなければならない。  
**受入基準**: merchant が再投入対象行だけを取得できる。

### FR-WR-06
undo は **latest successful write job only** としなければならない。  
**受入基準**: 過去 job への undo は reject される。

### FR-WR-07
undo は conflict row を skip しなければならない。  
**受入基準**: source job 後に別変更された row は `UNDO_CONFLICT` になる。

---

## 9.6 Billing / entitlement 要件

### FR-BL-01
billing default option は **Managed Pricing** でなければならない。  
**受入基準**: off-platform billing が存在しない。

### FR-BL-02
local entitlement truth は Shopify query 結果のみとしなければならない。  
**受入基準**: welcome link 到達だけで paid 化しない。

### FR-BL-03
local billing state は次でなければならない。  
- `UNENTITLED`
- `PENDING_APPROVAL`
- `ACTIVE_FREE`
- `ACTIVE_PAID`
- `PAYMENT_HOLD`
- `INACTIVE`

### FR-BL-04
`FROZEN` は `PAYMENT_HOLD` として扱い、paid feature を即時停止しなければならない。  
**受入基準**: billing hold 中に write を許可しない。

### FR-BL-05
upgrade / downgrade は support contact や reinstall を要求してはならない。  
**受入基準**: hosted pricing page から self-serve で遷移できる。

---

## 9.7 Webhook / compliance / lifecycle 要件

### FR-WH-01
v1 の webhook delivery method は **HTTPS only** でなければならない。  

### FR-WH-02
v1 の fixed webhook は **app-specific only** でなければならない。  
**topic**:
- `app/uninstalled`
- `app_subscriptions/update`
- `customers/data_request`
- `customers/redact`
- `shop/redact`

### FR-WH-03
webhook handler は raw body を変形せずに HMAC 検証しなければならない。  
**受入基準**: invalid HMAC は `401`、副作用なし。

### FR-WH-04
webhook は dedupe key による idempotency を持たなければならない。  
**受入基準**: duplicate delivery が `200` no-op になる。

### FR-WH-05
`app/uninstalled` 受信後は write を停止しなければならない。  

### FR-WH-06
`shop/redact` 受信後 7日以内に hard delete を完了しなければならない。  

### FR-WH-07
`customers/data_request` / `customers/redact` は v1 では no-op audit でよいが、応答と記録を必須とする。  

---

## 9.8 Review / support / privacy 要件

### FR-RV-01
listing には support email を必須設定しなければならない。  

### FR-RV-02
listing には app submission contact email を必須設定しなければならない。  

### FR-RV-03
listing には privacy policy URL を必須設定しなければならない。  

### FR-RV-04
privacy policy は retention / data deletion 契約と一致しなければならない。  

### FR-RV-05
reviewer が到達する merchant-facing routes は fatal-free でなければならない。  

---

## 10. データ要件

## 10.1 主な保持データ
- Shop lifecycle state
- offline token（暗号化）
- granted scopes snapshot
- entitlement snapshot
- export manifest
- import jobs
- import rows
- artifacts
- snapshots
- webhook inbox
- audit events

## 10.2 保持しないデータ
- customer payload
- order payload
- email / phone / address
- raw CSV の全文ログ
- raw webhook body の長期保存

## 10.3 retention
- source / preview / result / error artifact: 30日
- snapshots: 30日
- webhook dedupe keys: 30日
- redactable telemetry: 0〜7日
- pseudonymous telemetry: 8〜90日
- structured logs: 90日（shop-identifiable data を持たない形）

---

## 11. 非機能要件

### NFR-01 可用性 / 完全性
public app として install / reinstall / pricing / webhook / product workflow が運用可能でなければならない。

### NFR-02 セキュリティ
- session token 検証前に business logic を実行しない
- direct Admin API access を使わない
- offline token を平文保存しない
- HMAC invalid webhook に副作用を与えない

### NFR-03 準拠性
- public app / embedded / managed install / Managed Pricing / mandatory compliance webhooks を満たす
- GraphQL Admin API のみ使用する
- explicit API versioning を行う

### NFR-04 性能
- webhook handler は timeout budget 内に応答する
- write job は async で行う
- preview は同期 HTTP で完了を待たない

### NFR-05 可観測性
- install / auth / billing / webhook / write job を追跡できる
- correlation id を必須とする
- secret / token / raw body / raw CSV をログ禁止とする

### NFR-06 監査可能性
- 誰が preview / confirm / undo したか追える
- 課金状態変更と lifecycle 変更の監査痕跡が残る

---

## 12. KPI / guardrails

## 12.1 Product KPI
- install → first export 完了率
- install → first preview 完了率
- install → first successful write 完了率
- preview → confirm rate
- recurring usage rate

## 12.2 Guardrails
- invalid session retry spike
- webhook 2xx rate
- queue lag
- billing mismatch count
- unexpected overwrite support tickets
- undo rate
- preview invalidation rate

---

## 13. 受入条件（release gate）

以下をすべて満たした場合のみ launch 可能とする。

1. install / reinstall / bootstrap が dev store で通る
2. invalid session の document / XHR 分岐が通る
3. `read_products` / `write_products` 以外を要求しない
4. Managed Pricing の welcome link と entitlement refresh が通る
5. `FROZEN` が `PAYMENT_HOLD` に写る
6. webhook HMAC / dedupe / enqueue-before-200 が通る
7. `app/uninstalled` で write stop
8. `shop/redact` で hard delete
9. product export / preview / confirm / verify / undo が end-to-end で通る
10. final-state verification を経ない `SUCCESS` が存在しない
11. support email / submission contact email / privacy policy URL が揃う
12. reviewer が見る route が fatal-free

---

## 14. リリース計画

## 14.1 launch GA
- Product workflow only
- public embedded app
- Managed Pricing
- mandatory compliance webhooks
- install / reinstall / uninstall / redact / pricing / preview / write / verify / undo

## 14.2 v1.1
- app-internal RBAC の再検討
- handle update
- saved filters
- richer preview warnings

## 14.3 later
- collection workflow GA
- variants / inventory / pricing
- optional scopes を伴う非 universal feature
- more advanced data connectors

---

## 15. リスクと依存

### 15.1 主要リスク
- Product だけで継続利用価値が足りない可能性
- owner-only confirm が friction になる可能性
- billing hold / reinstall / redact の境界不具合が support 負荷になる可能性
- App Review で metadata / policy / redirect の細部不備が出る可能性

### 15.2 主要依存
- Shopify managed install
- App Bridge / session token
- currentAppInstallation query
- app-specific webhooks
- Managed Pricing hosted page
- GraphQL Admin API 2026-01

---

## 16. 用語

- **embedded app**: Shopify admin 内に埋め込まれるアプリ
- **session token**: frontend→backend 認証用トークン
- **online token**: user-context の Shopify Admin API 用 token
- **offline token**: background worker 用 token
- **manifest**: export artifact の provenance 情報
- **preview**: write 前の差分確認結果
- **final-state verification**: Shopify 書き込み後に最終状態を再読込して target と一致を確認する工程
- **entitlement**: billing / plan に基づく機能利用権
