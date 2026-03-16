# Shopify公開アプリ 技術仕様書（Product Domain Parity MVP版）

## 1. 文書目的

本書は、Product Domain Parity MVP を実現するための技術仕様を定義する。  
本版では、狭い Product-only から再編し、**Products ドメインに関わる bulk operation を end-to-end で完結させる**ことを launch v1 の目標とする。

本書は以下を固定する。

- launch v1 の技術スコープ
- 使用する Shopify API / scope / write strategy
- インフラ選定
- アプリ構成
- データフロー
- 運用・監視・失敗時ハンドリング
- phase 分割

---

## 2. 技術方針の再定義

### 2.1 旧方針の限界
「Products only + 少数フィールド」では、merchant が商品運用を完結できず、Matrixify 代替として弱かった。

### 2.2 新方針
launch v1 は **Product Domain Parity MVP** とする。  
これは以下のドメインを launch 対象に含む。

- Product core
- Variants
- Prices
- Inventory
- Media
- Product SEO
- Product Metafields
- Manual Collections
- Handle change + Redirects
- Export / Preview / Confirm / Write / Verify / Undo
- CSV / XLSX

### 2.3 非目標
launch v1 は **Matrixify 全リソース parity** は目指さない。  
Orders / Customers / Discounts / B2B / Metaobjects / Menus / Files as DAM / Connectors / Scheduling は phase 2 以降。

---

## 3. Shopify platform constraints

### 3.1 App shape
- public app
- embedded app
- Shopify managed install
- GraphQL Admin API only
- App Bridge
- Polaris UI
- session token + token exchange
- Managed App Pricing

Shopify は embedded apps に session tokens を必須とし、managed install + token exchange を推奨している。非埋め込み・legacy 向けの authorization code grant は通常導線に使わない。  
また、新規 public app は GraphQL Admin API 前提である。

### 3.2 Bulk operation constraints
- `bulkOperationRunMutation` を使用
- API version 2026-01 以降は shop あたり最大 5 本の bulk mutation を並列実行できる
- ただし app 自身は **self-limit 1 write job per shop** を維持する
- bulk mutation は 24 時間以内完了が必要
- verification を app 側で行う

### 3.3 API limits
- array input は最大 250 要素
- GraphQL Admin API は cost-based throttle
- inventory / redirects / variants は mutation 単位の batch size 制約を考慮して chunking する

---

## 4. launch v1 scope と Shopify API write strategy

## 4.1 Product core
### Fields
- title
- handle
- description/body
- vendor
- productType
- tags
- status
- SEO title / description
- product-level media associations（URL/staged upload を含む）

### Write strategy
- `productUpdate`
- bulk 実行時は `bulkOperationRunMutation` + `productUpdate`

### Notes
- `productUpdate` は product-level fields と associated media の更新に使う
- `productSet` は launch v1 の write path に使わない  
  理由: destructive semantics が広く、安全性と diff 解釈が難しくなるため

## 4.2 Variants
### Scope
- create
- update
- delete
- SKU
- barcode
- option values
- taxable / requires shipping など
- price / compare-at price（variant-level）

### Write strategy
- `productVariantsBulkCreate`
- `productVariantsBulkUpdate`
- `productVariantsBulkDelete`
- すべて app orchestration で product 単位に grouping して実行

### Notes
- product create は初期 variant 1 つしか持たないため、multi-variant workflow は variants mutation 群前提
- variant changes は product-level write と分離して stage 実行する

## 4.3 Inventory
### Scope
- export current inventory by location
- active inventory level に対する `available` quantity の absolute set
- compare-and-set aware UI（launch では backend 強制、UI は簡易でも可）

### Write strategy
- `inventorySetQuantities`
- `read_inventory` / `write_inventory` を要求
- `changeFromQuantity` を使った compare-and-set を標準動作とする
- stale quantity の row は conflict 扱い
- mutation は `@idempotent` を付け、`reason` は `correction`、`referenceDocumentUri` は preview job を指す app 固有 URI に固定する

### Notes
- inventory は product core / variants と別 mutation 系統
- launch v1 は baseline export に存在する active inventory level のみ更新対象とし、新規 location activation と tracked/untracked 切り替えは later
- inventory adjustments より absolute set を先に実装
- inventory rows は `variant_id + location_id` を identity とし、write は 250 rows 以下の chunk 単位で送る
- scheduled inventory は later

## 4.4 Media
### Scope
- product image/media の import
- external URL import
- staged upload import
- export 時は media metadata / links を返す

### Write strategy
- external URL または staged upload target を作成
- 必要時 `stagedUploadsCreate`
- 必要時 `fileCreate`
- product media association は product mutation 経由

### Scope implication
- `write_files` を要求
- full DAM / Files browser は launch v1 では対象外

## 4.5 Product metafields
### Scope
- product metafields export/import
- namespace/key/type/value 管理
- supported types の subset から開始
- launch v1 の supported type は `single_line_text_field`、`multi_line_text_field`、`boolean`、`number_integer`、`number_decimal`
- delete / clear semantics は launch v1 では扱わない

### Write strategy
- `metafieldsSet`
- batch size 25 制約を考慮して chunking

### Notes
- metafield definitions の新規作成 UI は phase 1.1 以降
- launch v1 は既存 definitions と明示 type 指定を優先
- export/read は product metafields connection を cursor pagination で最後まで取得する
- unsupported type は CSV へ出力せず、warning metadata で可視化する

## 4.6 Collections
### Scope
- manual collection membership export/import
- manual collection create/update（launch v1 の後半で解放可）
- smart collection は export / read を優先し、rule editor は phase 1.1 評価

### Write strategy
- membership add: `collectionAddProductsV2`
- membership remove: `collectionRemoveProducts`
- manual collection create/update: `collectionCreate` / collection update系 mutation
- published state は collection create 後に別 publish operation が必要

### Notes
- `collectionAddProductsV2` は async Job を返す
- `collectionRemoveProducts` も async Job を返す
- membership result は post-verification read で判定する
- export/read は product ごとの collections connection を cursor pagination で最後まで取得し、manual collections のみ row 化する
- app 自身は collection workflow も single-writer に乗せる

## 4.7 Redirects
### Scope
- handle change 時の redirect generation
- redirect export/import は launch v1 では行わない
- bulk redirect workflow は v1.1 以降独立させる

### Write strategy
- handle change write は `productUpdate(product: { id, handle, redirectNewHandle: true })` を正本にする
- redirect verify / undo cleanup の read は `urlRedirects(query: "path:...")` を使う
- undo cleanup は `urlRedirectDelete(id)` を正本にする
- bulk redirect import / delete は later

### Scope implication
- `read_online_store_navigation`
- `write_online_store_navigation`

### Notes
- canonical product path は `/products/{handle}` に固定する
- edited handle validation は Shopify の letters / numbers / hyphen contract を正本にし、app 内で独自 slugify しない
- preview と write 前再検証では `path=/products/{old-handle}` の live redirect 不在を要求し、same-path redirect があれば fail-fast する
- write success truth は handle の final-state verificationに加えて、`path=/products/{old-handle}` かつ `target=/products/{new-handle}` の exact redirect 1 件を要求する
- rollbackable 判定は redirect verify 成否ではなく handle mutation 適用有無で決める
- undo は snapshot/result を `productId` で join して対象行を確定し、redirect cleanup 後に handle restore を行う
- undo success truth は handle restore の final-state verificationに加えて、`path=/products/{old-handle}` の live redirect が 0 件であることを要求する
- Redirect module は scope 増加を伴うため、UI copy で明示する

---

## 5. launch v1 authenticated scopes

launch v1 required scopes は次で固定する。

- `read_products`
- `write_products`
- `read_inventory`
- `write_inventory`
- `write_files`
- `read_online_store_navigation`
- `write_online_store_navigation`

### rationale
- product / variants / collections は `write_products`
- inventory workflow は `read_inventory`, `write_inventory`
- media/file workflow は `write_files`
- redirects は online store navigation scopes

### non-goals
- customer / order / discount scopes は launch v1 から除外する

---

## 6. インフラ選定

## 6.1 方針
launch v1 の本番インフラは **AWS を採用**する。  
理由は以下。

1. web + worker + scheduler + object storage + secrets + logs を単一クラウドで閉じられる
2. Product Domain Parity MVP は **長時間 job / 大きいファイル / artifact 保持 / webhook / background processing** が前提で、serverless function 単体よりコンテナ常駐のほうが扱いやすい
3. Codex で扱う実装としても、container / Postgres / S3 のほうが局所変更しやすい
4. 将来の schedule / connectors / FTP/SFTP / URL import 追加に耐えやすい

## 6.2 本番インフラ構成
### Compute
- **ECS Fargate**
  - `web` service
  - `worker` service
- **EventBridge Scheduler**
  - reconciliation / retention / stuck job sweeps の定期起動

### Data
- **RDS PostgreSQL**
  - app DB
  - session storage
  - job state
  - queue
  - manifests
  - artifacts metadata
  - billing snapshots
  - webhook inbox

### Object storage
- **Amazon S3**
  - source upload
  - preview artifact
  - result artifact
  - error artifact
  - snapshots
  - temporary staged files

### Network / ingress
- **Application Load Balancer**
  - app HTTPS ingress
  - webhook HTTPS ingress
- **Route 53**
  - DNS

### Secrets / crypto
- **AWS Secrets Manager**
- **AWS KMS**

### Observability
- **CloudWatch Logs**
- **CloudWatch Metrics / Alarms**
- **OpenTelemetry-compatible traces**
- **Sentry**（アプリケーション例外用、任意だが推奨）

### CI/CD
- **GitHub Actions**
- container build → image push → ECS deploy
- app config 更新がある場合のみ `shopify app deploy`

## 6.3 採用しないもの
- Lambda-only 構成
- Vercel/Netlify のみで worker なし運用
- Redis/SQS を launch v1 の必須コンポーネントにすること
- EventBridge / PubSub webhook delivery
- direct-to-Shopify frontend Admin API calls

## 6.4 queue 選定
launch v1 は **PostgreSQL-backed queue** を採用する。

### rationale
- app state と job state を同一 transaction boundary に置ける
- early stage のオペレーションが簡単
- SQS などの追加 moving parts を避けられる
- Codex での実装と保守が比較的容易

### trade-off
- 高スループットには不利
- 将来 connector parity で負荷が増えたら外部 queue へ移行余地を残す

---

## 7. アプリケーション構成

## 7.1 サービス分割
### web
- embedded routes
- JSON API routes
- webhook ingress
- artifact download
- auth/bootstrap
- billing refresh

### worker
- product export
- preview generation
- staged write orchestration
- final-state verification
- undo
- entitlement refresh
- uninstall cleanup
- redact cleanup
- retention sweep
- stuck job sweep

## 7.2 code modules
- `platform/shopify`
- `domain/billing`
- `domain/webhooks`
- `domain/imports`
- `domain/products`
- `domain/variants`
- `domain/inventory`
- `domain/media`
- `domain/metafields`
- `domain/collections`
- `domain/redirects`
- `workers`
- `ui`

---

## 8. データフロー

## 8.1 Export
1. merchant が export request
2. worker が Shopify data read
3. canonical row model を生成
4. CSV / XLSX artifact を生成
5. `ExportManifest` 保存
6. source artifact を S3 に保存

## 8.2 Preview
1. merchant が file upload
2. provenance verify
3. parse / normalize
4. live Shopify state read
5. diff / warnings / errors 生成
6. preview artifact 保存
7. summary 保存

## 8.3 Confirm / write
1. owner confirm
2. preview hash revalidation
3. snapshot 作成
4. stage-by-stage write 実行
5. terminal completion 後に final-state verification
6. result / error artifact 保存

## 8.4 Undo
1. latest successful job を参照
2. conflict detection
3. rollback write
4. verification
5. result artifact 保存

---

## 9. Write orchestration strategy

Product Domain Parity MVP では、1 file = 1 atomic transaction は目指さない。  
代わりに **ordered execution stages + stage-level verification** を採用する。

### Stage order
1. Product core
2. Product core metafields
3. Variants create/update/delete
4. Prices / compare-at
   - launch 実装では `product-variants-prices-v1` profile として独立させる
   - `product-variants-v1` には price columns を混在させない
5. Inventory
6. Media
7. Collections membership
8. Redirects

### rationale
- mutation family が異なる
- Shopify object dependencies がある
- final-state verification を domain ごとに行いやすい

### rules
- stage failure は subsequent stages を止める
- partial success は artifact で可視化
- verify truth が通らない row は success にしない

---

## 10. File format strategy

## 10.1 launch v1 formats
- CSV
- XLSX

### rationale
Matrixify parity を意識するなら、CSV only では不足。  
実務上、Excel ベース運用が多く、Matrixify 自体も Excel / CSV / Google Sheets を前提にしている。  
ただし launch v1 では Google Sheets 直結は見送る。

## 10.2 compatibility mode
launch v1 は **partial Matrixify-compatible spreadsheet mode** を持つ。

### meaning
- app 独自 canonical template を正とする
- ただし主要 product-domain columns については Matrixify-style headers 受理を一部サポートする
- full template parity は later

### rationale
- 既存 Matrixify ユーザーの移行摩擦を下げる
- ただし full compatibility は scope が広すぎる

---

## 11. Route / auth / billing / webhook 方針（要約）

## 11.1 install/auth
- managed install
- embedded app
- App Bridge
- session token
- token exchange
- online token = request-scoped
- offline token = background only
- direct API access 禁止

## 11.2 billing
- Managed App Pricing
- entitlement truth = `currentAppInstallation`
- welcome link / webhook = trigger only

## 11.3 webhooks
- HTTPS only
- app-specific only
- raw body + HMAC
- durable enqueue before `200`
- no business logic inline

## 11.4 review metadata
- support email
- submission contact email
- privacy policy URL
- reviewer packet

---

## 12. Product Domain Parity MVP の最大懸念

### 12.1 scope friction
初期 install で要求する scope が増えるため、`read_products/write_products` only 案より friction は高い。

### 12.2 implementation complexity
Products 周辺を本気で完結させると、実装は「CSV app」ではなく **catalog operations platform** になる。

### 12.3 verification cost
`bulkOperationRunMutation` の completion だけでは truth にならず、最終状態 read-back verification が必要。

### 12.4 infra costより実装工数が重い
原価自体は bulk operations と S3/RDS で制御しやすいが、variant/media/inventory/metafield/redirect の例外処理が重い。

### 12.5 public app review message が難しくなる
scope が広がるため、「何をするアプリなのか」を catalog operations に明確に寄せる必要がある。

---

## 13. release strategy

### v1 launch
- Product Domain Parity MVP
- AWS infra
- CSV/XLSX
- Product/Variant/Inventory/Media/Metafields/Collections/Redirects
- Preview/Verify/Undo
- Managed Pricing

### v1.1
- Smart collections
- Google Sheets / URL import
- inventory adjust mode
- advanced compatibility mode
- richer presets

### later
- Customers / Orders / Discounts
- connectors
- schedules
- FTP/SFTP
- migration packs
- store copy

---

## 14. 最終結論

技術仕様として、launch v1 は「狭い Product-only importer」ではなく、**Product Domain Parity MVP を実現する catalog operations app** として設計する。  
インフラは **AWS（ECS Fargate + RDS PostgreSQL + S3 + Secrets Manager + KMS + CloudWatch）** を採用し、アプリは **embedded public app + managed install + token exchange + GraphQL Admin API** を前提とする。

この構成により、Matrixify 全体 parity ではないが、merchant にとって重要な **Products 周辺の bulk operation の実務完結性** を launch 時点で提供できる。
