# ソロ伴走型コーチ QA

最終更新: P3-SOLO-3（2026-10-18）。設計: [solo-coach-design.md](solo-coach-design.md)。

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

## 5. P3-SOLO-3 受け入れ条件

| 条件 | 状態 | 証跡 |
|---|---|---|
| 通知を無視してもゲームを続けられる | PASS | 通知は画面右上の小さなカードで、ゲームの入力には触れない。取得はゲーム画面の更新（局面の変化）を契機にし、タイマーで繰り返し取りにいかない。取得に失敗しても何も表示しない（`CoachReflection.spec`、サーバーは読み取り専用） |
| 最初の問いで正解を明かさない | PASS | Gate A の応答に、差額、代替の順序、判定の語が含まれない（`reflection.spec › asks first why…`）。問いかけ役（`questioner.ts`）が受け取るのは、判断の種類、カード、世代だけ（`keeps the questioner apart from the verdict`）。通知の文面も同じ |
| 回答に応じて次の問いが変わる | PASS | Gate A の 3 つの答えで、Gate B が 3 通りに分かれる（`lets the next question follow the answer`）。選択肢にない答えは 400 |
| 詳しい解説を希望すれば、検証済みの根拠を出せる | PASS | Gate C で根拠（割引の前後の費用など）を出す。「根拠と代替案を見る」で、代替案との差（合計 7 → 4 M€）と根拠を出す。比較はこの観点だけであることも明記する |
| 重要でない判断で過度に介入しない | PASS | 通知するのは、`intervention: true` かつ `severity: notable` だけ。`minor` は件数だけに数える。ページを開いた時点ですでにあった発見は通知しない。通知は一度に 1 件で、「あとで」「閉じる」の後は再通知しない |
| タブレットのゲーム UI を覆いすぎない | PASS | 指標（36px）と通知（最大幅 340px）は右上。実機の DOM で、縦横の各画面（火星、全カード、プレイヤー、ログ）で指標の下に操作要素がないことを確認した。ログ画面と横向きのプレイヤー画面ではずらして配置する |
| 行動前の介入は設定で | PASS | 既定はオフ。オンにすると、今の局面で出せる 2 枚の順序で費用が変わるときに「順序で費用が変わることがある」とだけ出す。カード名は「どのカード？」を押したときだけ見せる。局面が変われば消す |
| カットイン中に局面が変わったときの区別 | PASS | 振り返り（過去の判断）には「振り返り」の印と「世代 n：〜しました」を必ず付ける。行動前のヒントは局面ごとの ID で、局面が変われば消す。Undo で判断がなくなると「取り消された」と表示する（`status: 'gone'`） |
| AI の呼び出しを必要なときに限る | PASS | P3-SOLO-3 は決定的なテンプレートだけで、LLM を呼ばない |

| 試験（g10） | 結果 |
|---|---|
| 新規のサーバー試験（`reflection.spec.ts`） | 9 件 |
| 新規のクライアント試験（`CoachReflection.spec.ts`） | 8 件 |
| コーチ全体のサーバー試験 | 238 passing |
| `npm run test:server` | 7,956 passing / 0 failing |
| `npm run test:client` | 1,257 passed / Errors 1（既知の Vitest teardown、不安定） |
| eslint、`lint:i18n`、vue-tsc、`npm run build` | 成功 |
| `build:test`、`lint:css` | 既知の 3 件と 6 件だけ |

**ミューテーション**（3 件すべて検出）: Gate A で根拠を出す、minor でも通知する、ページを開いたときの既存の発見も通知する。

**実機での発見**: ログ画面では、指標がログの絞り込みボタンを、横向きのプレイヤー画面では、プレイヤー表のボタンを覆っていた。画面ごとに位置をずらして解決した。Vue のスコープ付き CSS は `:global(:has(...))` を壊すため、この 2 つの規則はスコープなしの `<style>` に置いた。
