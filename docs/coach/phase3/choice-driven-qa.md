# 選択主導型コーチ QA

最終更新: P3-CD-1 レビュー修正（2026-10-17）。シナリオ ID は [計画 §8](choice-driven-plan.md)。

## 1. シナリオ

| ID | シナリオ | 状態 | 証跡 |
|---|---|---|---|
| CD01 | 自分のアクション入力 | PASS | `counsel.spec › CD01/CD02`: Now のプロジェクトカードがゲームの `getPlayableCards()` と一致 |
| CD02 | `projectCard` から 1 枚選ぶ | PASS | 同上と CD15。選んでもプレイされない（`serialize()` が不変） |
| CD03 | `or` に複数の行動 | PASS | `CD03`: 賞の資金提供（入れ子の `or`）の枝が親の題名つきで残る |
| CD04 | `and` と複数選択 | 一部 | `and`、初期選択、Sell patents は 1 項目にまとめ、`not-action` で検討対象外。中身の対応は P3-CD-2 |
| CD05 | 研究フェーズの購入候補 | PASS | `CD05`: 購入は 1 項目の `card-selection`（`not-action`）で、プロジェクトカードにはならない |
| CD06 | 標準プロジェクト、青カードのアクション | 一部 | 標準プロジェクトは、実行できるものだけ PASS（不可のものは件数だけ）。青カードは一覧のみで検討対象外（P3-CD-2） |
| CD07 | `space`/`payment` など | 一部 | 1 項目の `input-not-analysed` で、検討対象外。数値や合法手は作らない |
| CD08 | 相手のターン | PASS | `CD08/CD09`: Now は空、`stateStatus: waiting-for-others` |
| CD09 | ゲーム終了 | PASS | 同上: 選択肢なし |
| CD10 | Future の `conditional`/`unknown` | PASS | `CD10/CD11`: 2 枚以上のプランは `legal-now` にならず、`plan-not-one-move` が付く |
| CD11 | 戦略プランが 0 件 | PASS | 同上: Now だけを表示 |
| CD12 | `complete: false` | PASS | `CD12`: 合計を出さず、「一部の効果は数値化されていない」と表示 |
| CD13 | 弱い選択 | 一部 | テンプレートでは、強みが示せなければ「はっきりした強みは見えない」とし、注意点を必ず出す。迎合しないことの評価は P3-CD-2 のベンチマーク |
| CD14 | 先読みの根拠がない | PASS | 予測のない選択には見通しを作らない（費用と残金のみ） |
| CD15 | 起動 → 選択 → 終了でゲーム不変 | PASS | `CD15`: すべての選択を検討しても `game.serialize()` が同一。モデルにゲームを操作する手段はない |
| CD16 | 連打、閉じる、取り消し | PASS | サーバー: 同じプレイヤーの検討は同時に 1 件（`busy`）、毎分の上限。画面: 新しい要求の前に古い要求を取り消す（`AbortController`）。選択肢の取得は最新の要求の結果だけを使い、古い応答が後から届いても上書きしない |
| CD17 | 生成中にカードがプレイされる | PASS | `CD17`: 応答の前に、**GameLoader から取り直した現在のゲーム**で局面を再確認し、変わっていれば `stale`（内容は返さない）。画面は局面が変わると「以前の局面」と表示 |
| CD18 | Undo で同じ局面に戻る | PASS（P3-CD-1 の範囲） | 局面トークンに Undo の回数と手数を含めるので、別の局面として扱う。生成中の Undo で Game オブジェクトが置き換わった場合も `stale` になる（サービスとルートの両方で回帰試験）。ゲームを読み込めない場合も `stale`。会話の文脈は対象外（自由会話は使わない） |
| CD19 | 他のプレイヤー、観戦者の ID | PASS | 観戦者 ID は 400。他のプレイヤーの選択肢は、本人の秘密 ID でしか取れない（既存の `CoachPlayerHandler`） |
| CD20 | 外部 LLM が未許可 | PASS | 設定オフまたは未同意では送信 0（`does not call the model without consent`）。テンプレートで続く |
| CD21 | タイムアウト、429、拒否、不正 JSON | PASS | `CD21/CD22`: いずれもテンプレートに戻り、`ai.state: failed` |
| CD22 | 根拠のない数字、存在しないカード | PASS | 引用した事実の数値、カード名、存在する根拠 ID、禁止表現を点ごとに検査する。A/B と根拠の対応も検査する（A の事実で B の主張を裏付けない、`evidence-of-other-option`）。不合格なら全体を捨てる |
| CD23 | 縦・横の表示 | PASS（ブラウザの表示サイズ指定） | 縦 768×1024・横 1024×768 で、パネルを開いたままアクションシート、ナビ、カードのプレイが使えた。実機タブレットは P3-CD-4 |
| CD24 | 16 言語 | PASS | 新しい文言 58 件。`lint:i18n` は全言語 100 %（英語と同じ綴りの 6 件は `sameAsEnglish.json`） |
| CD25 | 公開と非公開の境界 | PASS | モデルへの入力に、プレイヤー ID、ゲーム ID、観戦者 ID、局面トークン、選択肢 ID が含まれない（`sends no ids`） |
| CD26 | 分岐探索 | 対象外 | P3-CD-3 |
| CD27 | 全体の回帰 | PASS | §3 |
| CD28 | 実プレイ評価 | 対象外 | P3-CD-4 |

## 2. 実機デモ（g10、テスト用ソロゲーム）

1. メニューから「戦略コーチ」を開いた。今できる行動として次が並んだ（[画面](evidence/cd1-portrait-options.jpg)）。
   - Mineral Deposit（5 M€、今プレイ可能）
   - 標準プロジェクト 2 件（17 M€ で払えるものだけ）
   - パス
   - Sell patents（1 手ではない選択）
2. Mineral Deposit を選び、外部 AI の利用に同意して「この選択を検討」を押した（`gpt-6.1-sol`、約 6 秒）。
   - 返ってきたのは、強み 2・注意点 2・見通し 1・問い 1。どれも根拠 ID 付きだった（[画面](evidence/cd1-portrait-review-en.jpg)）。
3. コーチを閉じ、ゲームの「Play cards」から Mineral Deposit を出した。
   - ゲームの表示（費用 5、残り 12）は、コーチの事実カードと一致した（[画面](evidence/cd1-game-play-card.jpg)）。
4. 横向き・日本語で Mohole Area を検討した（[画面](evidence/cd1-landscape-review-ja.jpg)）。
   - 「費用 20 に対して所持金 12 で、現金だけでは払えない」と、建材での支払いが要ることを正しく指摘した。
   - 未完成の予測を合計とは見なさなかった。

デモでは、サーバーを AI オンで一時的に起動した。終了後は既定のオフに戻した（`ai.available: false`、プロセスの環境にキーなし）。

## 3. 自動試験（レビュー修正後、2026-10-17、g10）

| 試験 | ブランチ | 起点（`main` = `5e60b1488`、別の作業ツリーでビルド後に実行） | 差分の分類 |
|---|---|---|---|
| コーチのサーバー試験 | **205 passing / 0 failing** | — | 新規 30 件（`counsel.spec`） |
| コーチの画面試験（`CoachPanel.spec.ts`） | **18 passed** | 12 passed（Gate F の旧パネル） | 旧パネルの試験を置き換えた |
| `npm run test:server` | 7,922 passing / **1 failing** | 7,892 passing / 1 failing | 失敗はどちらも AI 対局の 60 秒タイムアウト（既知、起点でも発生）。増えたのは新規の 30 件だけ |
| `npm run test:client` | **1,243 passed / 0 failed** | 1,235 passed / 2 failed | 起点の 2 件（GameMenu）は単独では成功する、全体実行時だけの不安定な失敗。この PR の変更とは無関係（ブランチでは発生せず） |
| `npm run build:test`（テストの型検査） | エラー 3 件 | エラー 3 件 | 同じ 3 件（AdminRaw、RevealablePasswordInput。既知） |
| `lint:css` | 6 件 | 6 件 | 同じ（既知） |
| eslint（`lint:server`）、`lint:i18n`、vue-tsc（`lint:client`）、`npm run build` | 成功 | — | — |

**ミューテーション**（P3-CD-1 の 4 件に加えて、レビュー修正の 4 件。すべて検出）
- 再確認で GameLoader を使わず、最初の `player` を使う → 3 件失敗
- ルートで再取得を外す → 1 件失敗
- A/B と根拠の対応の検査を外す → 1 件失敗
- 画面で古い選択肢の応答を捨てない → 1 件失敗
