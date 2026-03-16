# ADR-0005 Product Domain Parity MVP boundary

- Status: Accepted

## Context
狭い Product-only MVP では Matrixify 代替として弱い。一方、full parity は launch には広すぎる。

## Decision
launch GA は Product Domain Parity MVP とする。
対象:
- Products
- Variants
- Prices / compare-at
- Inventory（launch v1 は active inventory level に対する available quantity absolute set のみ）
- Media
- Product Metafields
- SEO
- Manual Collections
- Handle change + Redirects
- CSV / XLSX
- Preview / Verify / Undo

除外:
- Orders / Customers / Discounts / connectors / scheduling / store copy

## Consequences
Product domain で業務完結性を持たせつつ、protected customer data を避けられる。
CSV/XLSX は launch scope に含むが、launch v1 の worksheet contract は canonical header/order の単一 worksheet に限定し、Google Sheets や Matrixify full compatibility には広げない。
