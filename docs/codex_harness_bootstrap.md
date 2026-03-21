# Codexハーネス導入ガイド（Product Domain Parity MVP版）

## 1. 目的
このドキュメントは、Codex がこのリポジトリを読み込んだ直後に、
**先にハーネスを整備し、その後に 1 ticket ずつ実装を進める**ための最小ガイドである。

## 2. 基本原則
- 1 セッション = 1 ticket
- docs を読んだら、まず harness tickets を進める
- 実装前に plan を作る
- architecture / source-of-truth の変更は ADR を残す
- 長文説明を増やすより、lint / test / contract / smoke / ADR を優先する
- Product Domain Parity MVP を対象とし、Orders / Customers / Discounts は対象外

## 3. 読む順番
1. `AGENTS.md`
2. `docs/shopify_app_requirements_definition_complete.md`
3. `docs/shopify_app_technical_spec_complete.md`
4. `.agent/PLANS.md`
5. `tickets/README.md`
6. 対象 ticket
7. 関連 ADR
8. 必要な skill

## 4. 最初にやること
- `tickets/harness/H-001-harness-bootstrap.md` を開く
- `plans/H-001.md` を作る
- `H-001` だけを完了させる

## 5. ADR が必須な変更
次の変更は、実装前に ADR を新規作成するか既存 ADR を更新する。
- install / reinstall / embedded auth
- session token / token exchange
- billing truth / plan transitions
- webhook policy / inbox / idempotency
- privacy / retention / redact
- route contract / state machine
- Product Domain Parity の対象範囲や source-of-truth
- infra selection（AWS / DB / queue / storage / secrets）

## 6. 進め方
- harness -> platform -> product domain -> operability
- 各 ticket 完了後に:
  - 実行した validation
  - 更新した ADR
  - 未解決事項
  - 次の ticket
  を残す

## 7. ローカルで `shopify app dev` を使うとき
- `pnpm dev` と CLI トンネル URL の扱いは **`docs/shopify_local_development.md`** を参照（`README.md` にも要約あり）。
