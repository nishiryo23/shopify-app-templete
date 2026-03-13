# AGENTS.md

このリポジトリでは、**先に Codex ハーネスを整備し、その後に Product Domain Parity MVP を 1 ticket ずつ実装する**。

## 最初に読む順番

1. `docs/shopify_app_requirements_definition_complete.md`
2. `docs/shopify_app_technical_spec_complete.md`
3. `docs/codex_harness_bootstrap.md`
4. `.agent/PLANS.md`
5. `tickets/README.md`
6. 対象 ticket
7. 関連 `adr/*`
8. 必要なら `.agents/skills/*/SKILL.md`

## Codex への基本ルール

- **harness tickets を先に完了**する。機能実装を先にやらない。
- **1 セッション 1 ticket** を原則にする。
- 非自明な変更の前に `.agent/PLANS.md` をテンプレとして `plans/<ticket-id>.md` を作る。
- task が skill に一致するなら、該当する `.agents/skills/<skill-name>/SKILL.md` を読んでから作業する。
- launch GA の対象は **Product Domain Parity MVP**。Orders / Customers / Discounts は対象外。
- 変更は、**コード / テスト / contract / smoke / ADR** を truth source とする。長文説明だけを増やさない。

## ADR ルール

- 新しい設計判断を含む ticket は、実装前に ADR を作るか既存 ADR を更新する。
- auth / billing / webhooks / retention / state machine / route contract / review metadata / infra selection に触る変更は ADR 必須。
- ADR は `adr/NNNN-short-title.md` に追加し、ticket と change summary に ADR 番号を残す。

## 変更禁止

- `shopify.app.toml`、scope、billing truth、webhook policy、privacy/delete contract は ticket に明示がない限り変更禁止。
- direct Admin API access、REST Admin API、off-platform billing、shop-specific webhooks は禁止。
- launch GA 対象外の Orders / Customers / Discounts を勝手に scope に追加しない。

## 検証

- 標準チェックは `pnpm check`。
- 実装変更には、少なくとも 1 つの test / contract fixture / smoke 変更を伴わせる。
- Product write path を変える変更では verification test を必須とする。
