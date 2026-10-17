# Phase 3 報告

計画: [TM-COACH-P3-MVP](plan.md)。ブランチ `coach/phase3-mvp`（起点 `525c50bb8` = `main`、Gate F マージ後）。

## Iteration 0 — AI と UX の選定（完了）

| 成果物 | 内容 |
|---|---|
| [ADR](adr-provider.md) | 4 モデルを同じ 24 局面・106 問で比較。標準は `gpt-6.1-sol` にした。機械検証は 212/212 合格、人による確認では事実の誤りが 0/10。応答 p95 は 8.8 秒、費用は 1 回あたり $0.0056 |
| [評価データ](evaluation-dataset.md) | テスト用ゲームから作った 24 局面（ソロ 18、2 人戦 6）と質問 7 種類。罠の質問、秘密を聞き出す質問、指示の無視を求める質問を含む |
| [UX の決定](ux-decision.md) | 案 A（起動ボタンからパネルを開く）を採用。配置は Gate F の実機確認に合わせ、上部バーの直下にする |
| PoC | 実際の API 接続に成功（OpenAI 2 モデル、Sarashina 2 モデル）。424 + 424 回を呼び出し、OpenAI の費用は合計 $1.23 |

実装（サーバー側、まだゲーム画面にはつないでいない）:
- `common/CoachChat.ts`: モデルに渡す文脈（`CoachLLMContext`）と、回答の形（`CoachModelReply`）。
- `server/chat/contextBuilder.ts`: 文脈を作る。ID、人の名前、相手の非公開カード、盤面、履歴は入れない。プラン名は仮名（P1…）にする。
- `server/chat/instructions.ts`: モデルへの指示（`coach-instructions/1`）と回答の JSON Schema。
- `server/chat/replyValidator.ts`: 回答を表示する前の機械検証。プラン、カード名、文脈にない数値、勝率や「最適」の断定、形、長さを調べる。
- `server/chat/providers/`: `CoachLLMProvider` の実装。
  - `openai.ts`: Responses API。`store: false`、タイムアウト、取り消し、エラーの種類分けに対応。
  - `chatCompletions.ts`: Sarashina などの Chat Completions 形式。毎分の回数上限まで間隔を空けて呼ぶ。
- `scripts/coach/chatBenchmark.ts`: 比較の実行。`--revalidate` で、API を呼ばずに記録済みの回答を再検査できる。
- `tests/extensions/coach/chat/`: 評価用の局面（24 件）、その生成スクリプト、試験 18 件。試験は文脈の秘匿、検証、両方の接続部分を見る。ネットワークは使わない。

外部への送信は、比較スクリプトを手で実行したときだけ。ゲームサーバーにはまだつないでいない。キーは g10 の `~/.config/tm-coach/*.env`（権限 600）に置いている。

## 方針変更 — 選択主導型（TM-COACH-P3-CD、2026-10-16）

Iteration 1 以降は [選択主導型の計画](choice-driven-plan.md) に置き換えた。
- 自由質問のチャットは補助機能にした。
- 主な体験は「ゲームの選択肢を見る → プレイヤーが選ぶ → その選択へのコーチング」にした。

## P3-CD-0 — 判断と契約の修正（ドキュメントのみ）

| 変更 | 内容 |
|---|---|
| [ADR](adr-provider.md) | `gpt-6.1-sol` を「初期候補・暫定デフォルト」に改めた。Iteration 0 の数値は残し、選択へのコーチングは未評価と明記した |
| [plan.md](plan.md) | 変更履歴を追加し、TM-COACH-P3-CD を優先することを明記した |
| [choice-driven-design.md](choice-driven-design.md) | 目的、画面の状態、Now と Future、入力の種類ごとの意味と対応（ゲームのコードで確認）、データ契約、AI の利用条件とセキュリティ、試験の対応、計画との差分 |
| [choice-driven-plan.md](choice-driven-plan.md)・[choice-driven-prompt.md](choice-driven-prompt.md) | 受け取った計画と着手指示を取り込んだ |
| [gaps.md](gaps.md) | Phase 3 の未対応事項 |

コードは変更していない（現行のパネルとチャットの部品に回帰はない）。

次: P3-CD-1（選択肢の一覧 → 選ぶ → 確定事実 → テンプレートと 1 モデルによる検討、の縦切り）。
