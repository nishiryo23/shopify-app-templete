# F-002 fork-init-script plan

## Goal
F-001 の fork 初期化チェックリストを `scripts/init-new-app.mjs` に集約し、アプリ名 / handle / 本番 URL / review metadata の同期漏れを防ぐ。

## Read first
- `AGENTS.md`
- `docs/template_scope.md`
- `docs/platform-truth-index.md`
- `tickets/README.md`
- `tickets/template/F-002-fork-init-script.md`
- `.agent/PLANS.md`
- `tickets/template/F-001-fork-initialization.md`
- `docs/app-review-metadata.md`
- `docs/reviewer-packet.md`
- `.agents/skills/adr-discipline/SKILL.md`
- `adr/0023-empty-minimal-access-scopes-baseline.md`

## Constraints
- `shopify.app.toml` の現在値、scope、billing truth、webhook policy、privacy/delete contract はテンプレ本体では変更しない。
- `shopify.app.development.toml` は fork 先で生成される雛形であり、webhook / scope の内容は本番 `shopify.app.toml` と同一に保つ。
- `client_id` は `shopify app config link` に委譲し、script では生成・推測しない。
- Shopify CLI `app config link` は config file を作成または上書きするため、production link は script 実行前 preflight として固定する。default の `shopify.app.toml` を link する手順は bare `shopify app config link` を正とし、`--config` は configuration name 用なので file path として使わない。
- GitHub Actions vars と task definition の `SHOPIFY_APP_HANDLE` は自動更新せず、実行後の手順として表示する。
- ネットワークや追加依存に頼らず、Node 組み込みのみで実装する。
- 既存 `SHOP_TOKEN_ENCRYPTION_KEY` は encrypted offline token 復号の正本なので既定で保持し、rotation は明示 flag のみ許可する。

## Steps
1. fork 初期化手順の正本移行を ADR-0025 として追加する。
2. `scripts/init-new-app.mjs` を追加し、対話式入力と非対話モードの両方で `.env` / docs / generated development toml を更新できるようにする。
3. review root-cause fix: production `shopify app config link` を script 実行前 preflight にし、canonical checkout / 未リンクテンプレートは no-write で fail-fast する。canonical 判定は `origin` を主 remote として扱い、fork の `origin` + canonical `upstream` は許可する。
4. review root-cause fix: ユーザー入力を含む `String.replace` は function replacement に統一し、`$&` / `$$` の replacement 展開を無効化する。
5. review root-cause fix: 生成対象 5 ファイルは全件生成・検証後に staging temp + rename + rollback で書き込む。
6. review root-cause fix: 既存 `SHOP_TOKEN_ENCRYPTION_KEY` は既定で保持し、明示 `--rotate-shop-token-key` なしの上書き入力は fail-fast する。
7. プレースホルダ残存検査、preflight no-write、secret 保持 / rotation、atomic write failure、origin/upstream remote 構成を script と contract test の両方に実装する。
8. `tickets/README.md` と F-001 に F-002 script 参照を反映する。
9. `pnpm check` を実行し、失敗した場合は修正して再実行する。

## ADR impact
- ADR required: yes
- ADR: 0025
- Why: fork 初期化の source-of-truth が F-001 の手動手順から F-002 の script に移るため。手動判断として残す範囲と script が担う範囲を ADR で固定する。

## Validation
- contract: `tests/contracts/fork-init-script.contract.test.mjs`
- `pnpm check`
- script は fork 先で実行されるため、このテンプレ本体の `shopify.app.toml` は差分なしであることを確認する。
- config link 順序、canonical checkout no-write、fork origin + canonical upstream 許可、未リンクテンプレート no-write、既存 key 保持、明示 rotation、`$` 入力、placeholder no-write、staged write failure no-write を contract で固定する。

## Risks / open questions
- Partner Dashboard 操作、`shopify app config link`、GitHub vars、task definition は script では自動化しない。
- scope 追加やドメイン webhook 追加は F-002 では扱わず、派生アプリ側の domain ticket + ADR に委ねる。
- 既存 `SHOP_TOKEN_ENCRYPTION_KEY` の誤 rotation は既存 encrypted offline token を復号不能にするため、既定保持と明示 flag を contract で固定する。
