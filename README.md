# Shopify Codex Bundle (Product Domain Parity MVP)

この bundle は、Codex に最初から読ませるための一式です。

## Main files
- `docs/shopify_app_requirements_definition_complete.md`
- `docs/shopify_app_technical_spec_complete.md`
- `AGENTS.md`
- `CODEX_START_PROMPT.md`
- `.agent/PLANS.md`
- `.agents/skills/*`
- `codex/rules/default.rules`
- `tickets/*`

## Start
1. `CODEX_START_PROMPT.md`
2. `AGENTS.md`
3. docs 2本
4. `tickets/README.md`

## Runtime notes
- `SHOP_TOKEN_ENCRYPTION_KEY`: offline token 暗号化用の base64 エンコード済み 32 byte key。未設定時は既存実装どおり開発環境で legacy fallback する。
- `PROVENANCE_SIGNING_KEY`: row fingerprint / manifest 署名用の base64 エンコード済み 32 byte key。offline token 用の鍵とは分離する。未設定のまま署名が必要な処理を呼ぶと fail-fast する。
