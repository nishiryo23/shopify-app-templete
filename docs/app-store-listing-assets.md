---
doc_type: review_artifact
authority: supporting
truth_sources:
  - docs/platform-truth-index.md
  - docs/release-gate-matrix.md
  - docs/app-review-metadata.md
---

# App Store リスティング資産の制作テンプレ（2026-07 要件準拠）

App Store 提出時のリスティング資産（画像・動画・説明文）を、fork 先アプリが迷わず作るためのテンプレ。
要件の一次情報: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements

## 必要資産（提出前チェックリスト）

- [ ] アプリアイコン 1200x1200（文字なし・スクショ流用禁止）
- [ ] スクリーンショット 1600x900 を 3〜6 枚（最低 1 枚は実 UI。ブラウザ chrome と機密情報はクロップ。各画像ユニーク）
- [ ] **デモ動画（screencast）— App Store review 提出時に必須（新規・再提出とも）**。オンボーディング〜主要機能を実演、英語音声または英語字幕、テスト用認証情報を添付
- [ ] アプリ説明文（下の雛形）と検索キーワード（日本語の高インテント語を優先）
- [ ] `docs/app-review-metadata.md` の実値化（推測値を入れず `UNCONFIGURED_BEFORE_SUBMISSION` のまま残す規律を守る）

## 制作フロー（allergy 実績の型）

1. dev store に代表データを投入し、実画面を Chrome で 1600x900 キャプチャ
2. 合成アートボード HTML（allergy `docs/app-store-assets/listing-artboards.html` を複製）で背景・キャプション合成
3. サイズ別に書き出し、`docs/app-store-assets/final/` に保存（元素材は `source/` に保持）

## 禁止事項（審査リジェクト要因。surface 別に確認する）

- **統計・数値データ・実績 claim・成果保証**（「売上300%増」等）: listing 本文（overview / introduction / details）にも画像にも載せない（App Store requirements 4.3.3 / 4.3.4。verifiable かどうかを問わない）
- **価格情報**: Pricing details 欄以外に載せない。listing 本文・overview / introduction・画像への価格記載はすべて不可（4.2.2 / 4.2.3）
- **レビュー引用・証言・評価スコア**: 画像・listing 本文・その他未指定エリアのいずれにも載せない（4.3.6 / 4.3.7）
- **Shopify 商標**: icon / banner / screenshots で使わない。本文でも互換性の記述として許された表現に限定する（4.4.3）
- 他アプリ・Shopify 公式を装う表現

## 説明文の雛形

- 1 行目: 「誰の・どの必須業務を・どう置き換えるか」を 1 文で（日本語検索語を含める）
- 本文: 課題 → 主要機能 3 点（箇条書き）→ 導入手順の簡単さ → サポート窓口

## 関連

- `docs/release-gate-matrix.md` — 提出前ゲート「Listing assets ready」行の evidence が本ファイル
- `docs/reviewer-packet.md`（審査担当者向け情報）
- `tickets/platform/P-009-growth-kit.md`（配布・収益化装置の実装 ticket。本 doc は同 ticket の (e) に相当）
