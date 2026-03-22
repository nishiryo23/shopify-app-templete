# AGENTS.md

このリポジトリでは、**先に Codex ハーネスを整備し、ドメイン機能は ticket + ADR で追加する**。

## 最初に読む順番

1. `docs/template_scope.md`
2. `docs/codex_harness_bootstrap.md`
3. `.agent/PLANS.md`
4. `tickets/README.md`
5. 対象 ticket
6. 関連 `adr/*.md`（`adr/archive/` は参照のみ）
7. 必要なら `.agents/skills/*/SKILL.md`

## Codex への基本ルール

- **harness tickets を先に完了**する。独自ドメインを先に実装しない。
- **1 セッション 1 ticket** を原則にする。
- 非自明な変更の前に `.agent/PLANS.md` をテンプレとして `plans/<ticket-id>.md` を作る。
- task が skill に一致するなら、該当する `.agents/skills/<skill-name>/SKILL.md` を読んでから作業する。
- テンプレの launch 対象は **最小プラットフォーム骨格**（認証・課金シェル・webhook・worker）。Orders / Customers / Discounts は対象外。
- 変更は、**コード / テスト / contract / smoke / ADR** を truth source とする。長文説明だけを増やさない。

## ADR ルール

- 新しい設計判断を含む ticket は、実装前に ADR を作るか既存 ADR を更新する。
- auth / billing / webhooks / retention / state machine / route contract / review metadata / infra selection に触る変更は ADR 必須。
- ADR は `adr/NNNN-short-title.md` に追加し、ticket と change summary に ADR 番号を残す。

## 変更禁止

- `shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract は ticket に明示がない限り変更禁止（**テンプレ初期化・fork 用の置換は別 ticket / ADR で明示**）。
- direct Admin API access、REST Admin API、off-platform billing、shop-specific webhooks は禁止。
- Orders / Customers / Discounts を勝手に scope に追加しない。

## 検証

- 標準チェックは `pnpm check`。
- 実装変更には、少なくとも 1 つの test / contract fixture / smoke 変更を伴わせる。
- deploy workflow は task render 前に必須 app config を fail-fast すること。
- optional な CI deploy path は clean runner 前提で成立させること。
- Docker build context には host 依存やローカル Shopify CLI state を混入させないこと。
