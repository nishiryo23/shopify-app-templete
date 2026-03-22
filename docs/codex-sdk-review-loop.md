---
doc_type: harness
authority: supporting
truth_sources:
  - docs/platform-truth-index.md
  - scripts/run-codex-shopify-review-loop.mjs
  - package.json
---

# Codex SDK review loop

`$shopify-review-fix` の remediation pass と、uncommitted diff に対する external review gate を Node.js で交互に回すためのメモ。

## 目的
- remediation は `shopify-review-fix` に任せる
- review は current uncommitted diff に限定して別 turn で判定する
- review が `clean` になったら終了する

## 実行コマンド

```bash
pnpm run codex:shopify-review-loop -- --max-iterations 5
```

主な option:
- `--cwd <path>`: 対象 repo。default は current working directory
- `--model <name>`: 使用モデル
- `--thread-id <id>`: fix thread を再開
- `--state-file <path>`: last review state の保存先。default は `.codex-shopify-review-loop-state.json`
- `--approval-policy <mode>`: default は `never`
- `--fix-sandbox <mode>`: default は `workspace-write`
- `--review-sandbox <mode>`: default は `read-only`

## 前提
- `@openai/codex-sdk` が install 済み
- Codex CLI の認証が済んでいるか、必要な OpenAI 認証情報が利用可能
- review 対象の uncommitted diff は、できるだけ 1 root cause に閉じていること

## 動作
1. fix thread が `$shopify-review-fix` を使って 1 remediation pass だけ実行する
2. review thread が current uncommitted diff を read-only で review する
3. `status=clean` なら終了
4. `status=findings` なら findings を次の remediation pass へ渡す
5. `status=blocked` または最大反復到達なら失敗終了

## Resume
- 各 review pass の結果は `.codex-shopify-review-loop-state.json` に保存される
- `--thread-id <id>` で再開すると、state file に保存された matching thread の review findings を次の fix prompt へ渡す
- clean 以外の終了経路でも `Fix thread id: ...` を出力するので、その値で再開できる

## 重要な制約
- Codex app の slash command `/review` を SDK から直接呼ぶ実装ではない
- 代わりに「current uncommitted diff を review する task」を SDK で実行して `/review` 相当の gate として扱う
- unrelated diff が混ざると review は `blocked` になりうる
