# Shopify公開アプリ 要件定義書（Product Domain Parity MVP版）

## 1. 文書目的

本書は、Shopify公開アプリの要件定義書である。  
本アプリは、当初の「狭い Product-only MVP」から方針を変更し、**Matrixify の価値の中でも Product ドメインに関わる業務が完結するレベル**を launch 対象の最小市場投入単位とする。

本書は以下を固定する。

- 何を launch v1 の価値として提供するか
- 何を parity 目標として段階追加するか
- 何を launch v1 から外すか
- どの仮説が成立すれば GO か
- どの論点が public app として重いか

---

## 2. 背景と再定義

### 2.1 変更前の問題
従来案は「Products only」を **title / status / vendor / productType / tags** 程度に限定しすぎており、merchant の現実業務を完結させるには弱かった。  
商品運用では、少なくとも次が一体で扱われる。

- Product core fields
- Variants
- Prices
- Inventory
- Media
- Collections
- Handle / Redirects
- Product metafields
- SEO fields

### 2.2 新方針
本アプリの launch v1 は **Product Domain Parity MVP** とする。  
これは「Matrixify 全機能 parity」ではなく、**Products ドメインに関しては実務が完結する**ことを意味する。

### 2.3 長期目標
長期目標は **Matrixify parity を段階達成すること**。  
ただし parity の単位は「リソースを増やすこと」ではなく、「merchant がある業務を end-to-end で終えられること」に置く。

---

## 3. Product thesis

### 3.1 北極星
日本語UIと日本語サポートを持つ、**Shopify 向けデータ運用アプリ**を作る。  
launch v1 の勝ち筋は「日本語UI」だけではなく、**Product ドメインの bulk update / import / export を安全に、理解しやすく、戻しやすくすること**に置く。

### 3.2 launch v1 のコア価値
launch v1 の価値は次の 4 つ。

1. **Product ドメインの bulk operation が end-to-end で完結すること**
2. **実行前 preview / diff / validation があること**
3. **実行後に verify / history / result / error artifact があること**
4. **失敗時に undo / rollback 判断ができること**

### 3.3 parity の定義
本プロダクトにおける parity は以下の 3 層で定義する。

- **Domain parity**  
  ある業務ドメインで merchant の実務が完結すること
- **Operational parity**  
  preview / history / scheduled jobs / artifact / monitoring など運用面が揃うこと
- **Connector parity**  
  CSV/XLSX/Google Sheets/FTP/SFTP/URL import など外部接続面が揃うこと

launch v1 は **Product domain parity + 基本的 operational parity** を目指す。  
Connector parity は v1.1 以降で段階追加する。

---

## 4. Product scope map

## 4.1 launch v1: Product Domain Parity MVP

### In scope
#### Products / Variants / Catalog
- Products create / update / export
- Product core fields
  - title
  - handle
  - description/body
  - vendor
  - product type
  - tags
  - status
  - template / publish-related product metadata（必要なものに限定）
- Variants create / update / delete
- SKU / barcode
- Price / compare-at price
- Option values
- Inventory policy / taxable / requires shipping 等の variant-level merchandising fields
- Product images / media references
- Product SEO title / description
- Product metafields
- Manual Collections membership
- Basic collection create / update（manual collections を優先）
- Handle change with redirect generation
- Export filters
- Import / export
- Preview / diff / validation
- Job history
- Result artifact / error artifact
- Final-state verification
- Undo / rollback（managed fields に限定）
- CSV
- XLSX
- 日本語UI / 日本語エラー / 日本語 help copy

### Included but intentionally constrained
- Redirects は **product handle change に付随する redirect 生成**を launch 対象に含める
- Redirects は **`/products/{old-handle} -> /products/{new-handle}` の product-linked redirect のみ**を launch v1 で扱う
- 既存 same-path redirect がある handle change は preview error または write 前 `revalidation_failed` として止め、暗黙上書きしない
- edited handle は Shopify の handle 契約に従う入力だけを受け付け、app 内で独自 slug を生成して補正しない
- undo は latest rollbackable write に限定し、handle restore とその write が作った forward redirect cleanup だけを扱う
- Inventory は **active inventory level に対する available quantity の absolute set** を第一実装とし、tracked/untracked 切り替え・location activation・adjust / scheduled inventory は v1.1 以降
- Media は **URL import と staged upload を前提**とし、Shopify Files 全体の DAM にはしない
- Collections は **product merchandising に必要な範囲**を優先し、Smart Collection rule の full editor は v1.1 以降評価

### Out of scope
- Customers
- Orders
- Draft Orders
- Discounts
- B2B Companies / catalogs pricing
- Payouts
- Pages / Blogs / Navigation menus
- Metaobjects
- Shopify Files 全量管理
- Google Sheets 直接同期
- FTP/SFTP / URL schedule import
- store-to-store copy
- full migration templates
- arbitrary mapping engine
- third-party platform migration packs

---

## 4.2 v1.1
- Smart Collections support 拡張
- Redirect bulk management 独立 workflow
- Inventory adjust mode / compare-and-set UI
- Google Sheets import
- URL import
- scheduled import/export
- advanced column presets
- Matrixify-compatible spreadsheet mode 拡張

## 4.3 later
- Customers / Orders / Draft Orders / Discounts
- store copy
- migration templates
- FTP/SFTP
- cloud storage integrations
- batch orchestration
- cross-resource transaction UX
- app-internal RBAC

---

## 5. Persona

### Primary
日本の merchant の商品運用担当 / EC運用担当

- Shopify admin とスプレッドシートを日常的に使う
- 商品投入、価格調整、終売、画像差し替え、タグ整理、SKU 管理、在庫更新をまとめて処理したい
- 英語の高機能 app を使えないわけではないが、日常運用チーム全体では不安がある
- 事故時に「何が変わったか」「戻せるか」を重視する

### Secondary
Shopify Partner / 制作会社の運用担当

- 運用保守案件で、商品まわりの更新を短時間で終えたい
- ただし Orders/Customers migration より catalog operations が主対象

### Tertiary
基幹/PIM から Shopify へ商品データを継続同期したい小〜中規模チーム

- launch v1 では fully automated sync までは対象外
- ただし将来の connector parity の顧客候補として扱う

---

## 6. JTBD

### Functional JTBD
「新商品投入、価格変更、在庫更新、画像差し替え、タグ整理、コレクション組み替え、SEO調整をするとき、**Products ドメインの bulk operation を 1 つの安全なフローで終わらせたい**。」

### Emotional JTBD
「CSV / XLSX を流す前に、**何が変わるのか分からない不安をなくしたい**。」

### Social JTBD
「変更後に、**誰が・いつ・何件変えたか**を上長や他部署に説明したい。」

---

## 7. 現行業務フローと課題

### 現行フロー
1. Shopify 標準 export
2. Excel / Sheets で編集
3. Shopify admin または app で import
4. 手で storefront / admin を点検
5. 問題があれば再投入または手修正
6. Collections / Redirects / Inventory を別操作で補う

### 主な課題
- Product ドメインの bulk 更新が複数 workflow に分断される
- Preview が弱く、実行前に最終影響を判断しにくい
- Variants / Inventory / Media / Redirects が別手段に散る
- エラーが英語かつ row-level で分かりにくい
- 「戻す」より「手で直す」になりやすい
- 標準機能では product 周辺の update が業務完結しにくい

---

## 8. To-be フロー

### Product Domain Parity フロー
1. merchant が対象 products を export
2. CSV / XLSX を編集
3. upload 後に app が file provenance を確認
4. preview / diff / validation を生成
5. merchant が preview を確認
6. owner が confirm
7. snapshot 作成
8. async write 実行
9. final-state verification
10. result / error artifact / history 参照
11. 必要なら undo

### merchant の意思決定に効く点
- 実行前に go/no-go 判断
- 実行後に再投入か手修正か判断
- 失敗時に rollback か部分修正か判断

---

## 9. Scopeと権限の含意

Product Domain Parity MVP に広げることで、launch v1 は次の scope set を前提とする。

- read_products
- write_products
- read_inventory
- write_inventory
- write_files
- read_online_store_navigation
- write_online_store_navigation

この拡張により、初期の “read_products / write_products だけ” より public app review 難度は上がる。  
ただし Customers / Orders を含めないため、protected customer data の重さはまだ避けられる。

---

## 10. v1 の実装優先順位

### P0
- Product core update
- Variants update
- Prices / compare-at
- Inventory set
- Media URL / staged upload
- Product metafields
- SEO
- Manual Collections membership
- Handle change + redirect generation
- CSV / XLSX
- Preview / verify / history / undo

### P1
- Collection create/update
- Smart Collection partial support
- Redirect bulk workflow
- advanced export presets

### P2
- Google Sheets / URL import
- scheduling
- connector layer

---

## 11. 主要な懸念

### 11.1 スコープ拡大による review / install friction
初期 scope が増えるため、install 時の心理的ハードルが上がる。  
特に inventory と redirects は merchant にとって「Catalog 管理以上」の印象を与えうる。

### 11.2 実装複雑性の急増
Product only でも、Variants / Inventory / Media / Metafields / Redirects を含めると、単なる CSV importer ではなく **catalog operations platform** になる。

### 11.3 `productUpdate` 単独では足りない
Variants は `productUpdate` では更新できず、variant-specific mutation 群が必要になる。  
Inventory も別 mutation と compare-and-set の考慮が必要。

### 11.4 Redirect 追加で scope が増える
Handle change と redirect generation を launch v1 に入れるなら、online store navigation scope が必要になる。

### 11.5 Media 対応で file scope が増える
Shopify media/file ワークフローを扱うなら `write_files` を含む設計が必要になる。

### 11.6 Matrixify parity は scope ではなく “運用面” が重い
preview / verify / artifacts / schedule / connectors / backup / compatibility mode のほうが、単に resource を増やすより重い。

---

## 12. GO / NO-GO 条件

### GO
- Product domain を end-to-end で完結させる scope に merchant が対価を払う
- Product core だけでなく、Variants / Inventory / Media / SEO / Metafields / Collections の一体運用ニーズが確認できる
- launch v1 scope 増加による install friction を許容できる
- Product domain parity だけで初期 paid conversion が成立する

### NO-GO
- 顧客期待が Orders / Customers parity に強く寄る
- 商品運用の recurring use より migration 一回利用が中心になる
- install 時の scope 拒否や review friction が高すぎる
- Product domain parity でも Matrixify / 既存競合との差別化が弱い

---

## 13. 成功指標

### Product value KPI
- install → first export
- install → first preview
- install → first successful import
- preview → confirm conversion
- 30日以内の再利用率
- Products domain workflow 利用率
- undo rate
- support tickets / 100 active shops

### Business KPI
- trial/free → paid conversion
- 90日 retention
- paid shops における Product Domain Parity 機能利用幅
- 日本語サポート起因の満足度

---

## 14. 再編後の結論

結論として、launch v1 は「狭い Product-only MVP」ではなく、**Product Domain Parity MVP** に再編する。  
これは Matrixify の全機能 parity ではないが、merchant から見て **商品運用の bulk operation が一連で完結する最小単位**である。

Customers / Orders / Discounts を launch v1 に入れないのは後退ではなく、**public app として review / data sensitivity / implementation risk を制御しながら、Product ドメインだけは明確に強いプロダクトにするため**である。
