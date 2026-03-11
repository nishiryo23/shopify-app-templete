# PLANS.md

複雑な変更や architecture/source-of-truth 変更を含む ticket は、実装前に `plans/<ticket-id>.md` を作る。

## Template

```md
# <ticket-id> plan

## Goal
この ticket で何を完了させるか。

## Read first
- 対象 ticket
- 関連 ADR
- 関連 skill
- 関連 docs / contracts / tests

## Constraints
- 触ってよい範囲
- 変えてはいけない truth
- launch scope 外のもの

## Steps
1.
2.
3.

## ADR impact
- 新規 ADR が必要か
- 既存 ADR 更新で足りるか
- ADR 番号

## Validation
- unit / integration / contract / smoke
- `pnpm check`
- 追加で必要な確認

## Risks / open questions
- 今回は解かないもの
```

## ADR impact の目安
次は ADR 必須:
- auth / lifecycle / billing / webhook / retention / state machine / route contract / infra
- Product Domain Parity の resource boundary 変更
- new scope
- new background processing truth
