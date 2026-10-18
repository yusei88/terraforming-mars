# ソロ伴走型コーチ QA

最終更新: P3-SOLO-2（2026-10-18）。設計: [solo-coach-design.md](solo-coach-design.md)。

## 1. P3-SOLO-1 受け入れ条件

| 条件 | 状態 | 証跡 |
|---|---|---|
| カードを 3 枚購入したとき、購入したカードと世代を確認できる | PASS | `timeline.spec › shows a research purchase of three cards…`: 世代 2 の `buy-cards` 1 件に 3 枚。提示された 4 枚も保持し、プレイとは混同しない。開始時の購入（`initial-selection`）も 1 件 |
| 2 枚を異なる順番でプレイしたとき、実際の順序が表示される | PASS | `keeps the order in which two cards were played…`: Sponsors → Earth Office の順。順番、判断時点の費用、支払い、前後の M€ と生産も確認 |
| Undo の後、古いイベントが現行の履歴として評価されない | PASS | `evaluates only the current line of play after an undo`: 実際の入力ルートで Undo し、Game オブジェクトが置き換わった後も、取り消したプレイは `superseded` に分かれる。現行の順番にも入らない |
| パネルの開閉でゲームの状態が変わらない | PASS | `serves the timeline read-only through the route`: `game.serialize()` とトレースの行数が変わらない |
| 再起動を挟んでも、永続化が有効なら履歴を作り直せる | PASS | `builds the same timeline again after a server restart (files)`: 同じディレクトリに新しいトレーサーを作り、同じタイムラインになる。そのまま続きを記録できる |
| イベントの重複処理の防止 | PASS | `counts each recorded decision once…`: 同じ `seq` の行が重なっても 1 件 |
| 非ソロゲームで無効 | PASS | `status: 'not-solo'`。画面にタブを出さない |
| `COACH_TRACE_DIR` が未設定 | PASS | `status: 'disabled'` と理由を表示する。空の成功には見せない |
| 選択肢の種類の区別 | PASS | 標準プロジェクト、Sell patents、パス、ゲームの行動（熱の変換など）を区別する |

## 2. 実機（g10、ブラウザの表示サイズ指定）

対象は、記録を有効にして（`COACH_TRACE_DIR`）実際に遊んだテスト用ソロゲーム。

- `GET api/coach/timeline` の結果:
  - `status: ok`、`history: valid`、勝利条件は「世代 14 までに地球化」
  - 世代 3〜5 の購入、標準プロジェクト、熱の変換、パス、プレイが、実際の順で並んだ
- 縦 768×1024: パネル（上 52〜462px）は、アクションシート（700px〜）と下部ナビ（956px〜）に重ならない。長いときはパネル内でスクロールする（[画面](evidence/solo1-timeline-portrait.jpg)）。
- 横 1024×768: パネル（右上、52〜398px）は、アクションシート（444px〜）と下部ナビ（700px〜）に重ならない。

## 3. 自動試験（g10）

| 試験 | 結果 |
|---|---|
| 新規のサーバー試験（`tests/extensions/coach/solo/timeline.spec.ts`） | 9 件 |
| 新規のクライアント試験（`CoachTimeline.spec.ts`） | 6 件 |
| コーチ全体のサーバー試験 | 214 passing |
| `npm run test:server` | 7,931 passing / 1 failing（既知の AI 対局タイムアウト。`main` でも発生） |
| `npm run test:client` | 1,249 passed |
| eslint、`lint:i18n`、vue-tsc、`npm run build` | 成功 |
| `build:test`（テストの型検査）、`lint:css` | 既知の 3 件と 6 件だけ（`main` と同じ） |

## 4. P3-SOLO-2 受け入れ条件

| 条件 | 状態 | 証跡（`tests/extensions/coach/solo/evaluator.spec.ts`） |
|---|---|---|
| 合法な代替の順序による割引の差を正しく計算できる | PASS | Sponsors → Earth Office の順に対して、逆順なら 7 → 4 M€（差 3）と計算した。**本体エンジンで逆順に実際にプレイ**して、Sponsors の費用 3、合計 4 M€ を確認（Golden）。実際の順序がよい場合は検知しない |
| 実行できなかった代替案を正解として扱わない | PASS | 判断時点で出せなかったカードは除外（`later-card-not-playable-then`）。支払いはエンジンの規則（建材は建物タグ、チタンは宇宙タグ、Helion の熱）で、両方を払えるかを確認 |
| 付随効果を評価できないカードで誤った断定をしない | PASS | M€ 以外の生産（Power Plant）は `conditional`、問いかけの候補にしない。場のカードがプレイに反応する場合（企業 Interplanetary Cinematics）は判定しない |
| 現在の得点と終了時の予測得点を混同しない | PASS | 評価は M€ の差（この観点だけ）。VP は「今加わる VP」だけを根拠に持ち、終了時の得点は予測しない。タイムラインの得点は現在の値 |
| 過去の判断を未来の情報で評価しない | PASS | 各判断は、その判断の直前のスナップショットだけで評価する。後から手に入ったカードで、以前のプレイを評価しない |
| 数値の根拠を説明できる | PASS | 発見ごとに根拠 `E1`…（費用、提示されていたカード、割引、資源、支払いの確認、予測）。どの判断の前後の局面か、カタログか、分析かを記録 |
| 評価が不十分なときは介入の候補を出さない | PASS | `intervention: true` は、`verified`、未解析の効果なし、差が M€ 2 以上のときだけ。間に他の行動がある、最大の条件がある、最終世代の購入などは `conditional` |
| 取り消された判断を評価しない | PASS | `series: 'current'` だけを評価 |
| 非ソロで無効、記録の無効を明示 | PASS | `not-solo`、`disabled` |
| ゲームの状態が変わらない、ID が安定 | PASS | ルート経由で `serialize()` 不変。同じ履歴なら同じ発見 ID。秘密の ID なし。「最適」「悪手」などの語を使わない |

**ミューテーション**（5 件すべて検出）
- 判断時点で出せなかったカードを代替案に使う
- 建材の支払い規則を外す
- 未達の条件を「不可能」とみなす
- 付随効果を無視する
- 取り消された判断を評価する

**実機**（g10、記録を有効にしたテスト用ソロ）: `GET api/coach/findings` は `status: ok`。購入 3 件を評価し、1 件は後でプレイ済み、2 件は問題の根拠なしで、発見は 0 件だった（誤検知なし）。発見が出る局面の実演は、試験の局面（実際のエンジン）で行った。

| 試験（g10） | 結果 |
|---|---|
| 新規のサーバー試験 | 15 件 |
| コーチ全体のサーバー試験 | 229 passing |
| `npm run test:server` | 7,946 passing / 1 failing（既知の AI 対局タイムアウト） |
| `npm run test:client` | 1,249 passed / Errors 1（既知の Vitest teardown。不安定） |
| eslint、`lint:i18n`、vue-tsc、`npm run build` | 成功 |
| `build:test`、`lint:css` | 既知の 3 件と 6 件だけ |
