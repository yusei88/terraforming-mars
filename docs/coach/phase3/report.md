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

## P3-CD-1 — 最初の縦切り MVP

ブランチ `coach/phase3-choice-driven-1`（P3-CD-0 の上）。

| 項目 | 内容 |
|---|---|
| 選択肢 | `GET api/coach/options` → `coach-choice-list/1`（[設計 §4・§5.1](choice-driven-design.md)）。入力の種類は、ゲームの入力クラスで判定する。値は `CoachChoices` から取る。Future は分析のプラン |
| 検討 | `POST api/coach/counsel` → `coach-counsel/1`。局面を作り直して照合し、事実カードを作る。テンプレートで強み・注意点・見通し・問いを作る。AI は 3 条件が揃ったときだけ使う（`gpt-6.1-sol`）。点ごとに根拠を検証し、応答の前に局面を再確認する |
| 安全 | 同一オリジンと JSON の確認、2 KB まで、項目の検証、同時に 1 件、毎分の上限、`no-store`、ゲームを変えない、ID を送らない |
| 画面 | Gate F のパネルを、選択主導の画面に置き換えた（配置は同じ）。今できる行動と将来のプラン、選択、確定事実、検討、比較、選び直し、根拠、AI の同意、局面が変わったときの表示 |
| 再利用 | Phase 2 の分析、Gate F の配置と `coachText`（`common` へ移した）、Iteration 0 の接続部品と検証の関数 |
| 翻訳 | 新しい文言 58 件を 16 言語で追加した |
| 試験 | 新規 43 件（サーバー 26、クライアント 17）。全体の回帰は [QA](choice-driven-qa.md) §3 |
| モデルの利用 | デモで `gpt-6.1-sol` を 2 回呼んだ（テスト用ゲームのみ）。既定はオフ（[運用](operations.md)） |
| ゲームを変えないこと | `CD15` で `game.serialize()` が同一。経路はすべて読み取り専用で、モデルにツールを与えない。ゲームのコードは変更していない |

未対応は [gaps.md](gaps.md) に記録した。

次（P3-CD-2）:
- 青カードのアクション、研究フェーズの購入、複数選択、入れ子の入力を、種類ごとに確かめて広げる。
- 事実の意味を明確にする（ブロッカーの `observed` と `gap`）。
- 根拠の検証と、人による評価のレポート。
- 選択レビューのベンチマーク（迎合しないかを測る）。
- 1 タップの起動ボタン。

### P3-CD-1 のレビュー修正（2026-10-17）

| 指摘 | 修正 |
|---|---|
| 1. 回答後の局面の再確認 | `counsel()` は `reload` を必須で受け取る。ルートは GameLoader から現在のゲームを取り直して照合する（Undo では Game オブジェクトごと置き換わるため）。サービスとルートの両方で、生成中の Undo（以前の保存から新しい Game に置き換え）の回帰試験を追加した。ゲームを読み込めない場合も `stale` にした |
| 2. A/B と根拠の対応 | A の点は A か `game` の事実、B の点は B か `game` の事実だけを引用できる。違反は `evidence-of-other-option` で回答全体を捨てる。問いは両方を比べるので、すべての事実を引用できる。モデルへの指示にも書いた |
| 3. 選択肢取得の順序の逆転 | 要求に番号を付け、最新の要求の応答だけを使う。前の要求は取り消す。古い応答が後から届く試験を追加した |
| 4. 設計書の契約 | [choice-driven-design.md](choice-driven-design.md) §5 を型定義と一致させた（リクエストの `mode: 'facts' \| 'review'`、事実の `about: 'A' \| 'B' \| 'game'`、点の `about: 'A' \| 'B'`、`status`、`source`、`ai.state`、エラー応答）。§7 に A/B と根拠の対応の検証を追記した |

試験の結果と起点との比較は [QA](choice-driven-qa.md) §3。追加機能はない。

## P3-SOLO — ソロ専用・伴走型コーチ（2026-10-18〜）

設計: [solo-coach-design.md](solo-coach-design.md)。既存の仕組みと不足の対応表、構成、型、P3-SOLO-3/4 の計画を書いた。QA: [solo-qa.md](solo-qa.md)。

### P3-SOLO-1 — 意思決定の履歴とタイムライン

| 項目 | 内容 |
|---|---|
| 正規化 | `server/solo/timeline.ts`（DecisionEventNormalizer）。記録済みの決定を、提示された選択肢の木に沿って意味のあるイベントにする（購入、開始時の選択、プレイ、標準プロジェクト、カードのアクション、Sell patents、パス、ターン終了、ゲームの行動、途中の入力、Undo、取り消し）。判断前後のスナップショットで意味を確認し、`verified` に記録する |
| 系列 | Phase 1.5 の `current` / `superseded` / `unverified` をそのまま使う。世代ごとの行動の順番は、現行系列だけで振る |
| API | `GET api/coach/timeline` → `coach-timeline/1`。本人のみ、`no-store`、読み取り専用。非ソロ、記録の無効、読み込みの失敗は、それぞれ状態として返す |
| 追加 | `CoachTracer.statesOf()`: スナップショットを 1 回の読み込みで取り出す |
| 画面 | パネルに「選択肢 / タイムライン」の切り替えを追加（ソロのみ）。世代ごとの購入、プレイの順番と費用、取り消した行動（折りたたみ）、勝利条件、現在の TR と VP |
| 翻訳 | 新しい文言 25 件を 16 言語で追加 |
| ゲーム本体 | 変更なし |

### P3-SOLO-2 — 戦略評価と反実仮想（決定的、LLM なし）

| 項目 | 内容 |
|---|---|
| 評価器 | `server/solo/` |
| A. プレイ順による割引損失（`counterfactual.ts`、CounterfactualEvaluator） | 同じ世代の X → Y について、X の判断時点で Y が出せたか、Y の割引が X に効くか（`costAfterDiscount`、Golden 検証済み）、両方を払えたか（エンジンの支払い規則）、X の条件が崩れないかを確かめる。両方の順序の合計費用を比べる |
| B. 購入後のプレイ困難（`purchases.ts`） | 購入時点で最大の条件をすでに超えていたもの（二度と出せない）は `verified`。最終世代で条件が未達のものは `conditional`。後でプレイしたカードと、単に未プレイなだけのカードは対象外 |
| C. 生産投資の回収不足（`payback.ts`） | 残りの生産フェイズが 3 以下のとき、Phase 2 の予測で回収できるかを見る。M€ 生産だけで VP・TR・他の生産がなく、効果がすべて数値化されたときだけ `verified` |
| 根拠と統合（`evidence.ts`、`evaluator.ts`） | EvidenceBuilder（根拠 `E1`…）、安定 ID、SoloStrategyEvaluator、InterventionCandidate（`verified`、未解析なし、差が M€ 2 以上） |
| API | `GET api/coach/findings` → `coach-findings/1`。本人のみ、`no-store`、読み取り専用 |
| 画面 | なし。問いかけは P3-SOLO-3 で、結論を先に見せない設計にする |
| ゲーム本体 | 変更なし |

### P3-SOLO-3 — 通知と段階的な問い（決定的、LLM なし）

| 項目 | 内容 |
|---|---|
| 問いかけ役（`server/solo/questioner.ts`、CoachQuestioner） | 判断の種類、カード、世代だけを受け取る（結論は型の上で受け取れない）。Gate A は理由、Gate B は見落とした観点（A の答えで分岐）、Gate C は根拠を見て再評価、最後に完了。ほかにヒント（結論なし）とルール（確定した一般的な事実） |
| 振り返り（`server/solo/reflection.ts`） | 発見を探して答えを検証し、問いを返す。Gate C では評価役の根拠を、「解説」では代替案との差と根拠を返す |
| 行動前のヒント（`server/solo/prospective.ts`） | 今の局面で出せる 2 枚の順序で費用が変わる場合。既定はオフ |
| API | `POST api/coach/reflection`（`coach-reflection/1`。同一オリジン、JSON、1 KB、読み取り専用）。`GET api/coach/findings?upcoming=1` |
| 画面 | `CoachWatcher.vue`: 見守り中の指標（世代、未読数）と通知（一度に 1 件、notable だけ、振り返る・あとで・閉じる）。パネルの「振り返り」タブに、設定（見守り、行動前のヒント）、振り返りの一覧、段階的な問い、ヒント、ルール、根拠と代替案、自分の考えのメモ（端末内のみ）を置いた |
| 翻訳 | 新しい文言 77 件を 16 言語で追加 |
| ゲーム本体 | 変更なし |
