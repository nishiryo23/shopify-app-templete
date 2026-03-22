# Codex Start Prompt

このフォルダをプロジェクトルートとして読み込んでください。作業は次の順で進めます。

1. `AGENTS.md` を最初に読む。
2. `docs/template_scope.md`、`docs/codex_harness_bootstrap.md` を読む。
3. `tickets/README.md` を読み、**harness tickets から順番に**進める。
4. 対象 ticket を開き、関連する ADR と skill を確認する。
5. 非自明な変更の前に `.agent/PLANS.md` をテンプレとして `plans/<ticket-id>.md` を作る。
6. ticket に設計判断が含まれるなら、実装前に `adr/NNNN-short-title.md` を追加または更新する。
7. 実装後は、差分要約、実行した検証、ADR への追記、未解決事項、次の ticket を示す。

## このセッションで守ること

- **1 セッション 1 ticket**
- harness tickets を先に完了する
- テンプレは **最小プラットフォーム**（ドメイン機能は ticket で追加）
- Orders / Customers / Discounts は scope 外
- ticket に明示がない限り `shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract を変えない

## 最初にやること

- `tickets/harness/H-001-harness-bootstrap.md` を読む
- `plans/H-001.md` を作る
- `H-001` だけを実装する
