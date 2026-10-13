# Phase 1 QA — テスト仕様と結果（S01〜S31）

実施日: 2026-10-14 / 環境: GMKtec G10（Ubuntu 24.04, Node v24.13.0）、ブランチ `coach/phase1`（起点 `fd22ef8b5`）
サーバー: `npm start`（SQLite、`PORT=8081`、`COACH_TRACE_DIR=~/work/coach-trace`）と Docker Compose（Node 22、ポート 8080、`tm-db` ボリューム）。

## 1. 試験区分

| 区分 | 内容 | 状態の作り方 | ファイル |
|---|---|---|---|
| **U** 単体 | 正規化・カタログ・指紋など関数単位 | テスト用モデルを直接構築 | `choices.spec.ts`, `cardCatalog.spec.ts` |
| **C** 構築統合 | 実ゲームオブジェクトを**テスト用に状態構築**して投影 | `testGame()`、資源・カードの直接設定 | `projectCoachState.spec.ts`, `coachTrace.spec.ts`（一部） |
| **N** 通常操作統合 | 実ゲームを**通常の入力経路**（`player.process` / `POST /player/input`）だけで進める | 初期化以外の状態操作なし | `playthrough.spec.ts`, `coachTrace.spec.ts` の route 試験 |
| **A** API 契約 | HTTP ハンドラの応答・認可・ヘッダ | ルート試験用スキャフォールド | `routes.spec.ts` |
| **L** 実機 E2E | 稼働中サーバーに HTTP で対局し、毎手 `/api/coach/state` と `/api/player`（画面モデル）を照合 | UI でゲーム作成 → `liveCheck.ts` が通常入力で進行 | `scripts/coach/liveCheck.ts`, `docs/coach/evidence/` |
| **B** ブラウザ | 内蔵ブラウザで UI を操作・目視し CoachState と照合 | UI 操作 | 本書 §4 |

## 2. 実行結果サマリ

| 試験 | 結果 |
|---|---|
| 新規 coach テスト（mocha） | **58 passing / 0 failing** |
| 既存サーバーテスト全体（`npm run test:server`） | 最終実行 **7,776 passing / 0 failing**（新規 58 件を含む）。途中の 2 回は既存の AI 対局テストが 60 秒タイムアウトで 1 件失敗（時間依存の不安定テスト。最終回は 50.5 秒で成功） |
| 既存クライアントテスト（`npm run test:client`） | 1225 passed、Vitest の teardown 未処理エラー 1 件（**起点コミットでも同一事象**） |
| `npm run build` | 成功（webpack 警告 3 件は既存：Less の非推奨構文・バンドルサイズ） |
| `npm run lint` | `lint:server`（eslint）・`lint:i18n`・`lint:client`（vue-tsc）成功。`lint:css` は既存 .less 6 件で失敗（**起点コミットでも同一**、本変更は CSS に触れていない） |
| `tsc --build tests/tsconfig.json` | 新規ファイルのエラーなし（既存 2 ファイル 3 件の .vue 型エラーのみ） |
| L: ソロ・基本のみ（UI 作成） | 110 手、**1,781 チェック / 失敗 0**、HTTP p95 4.4 ms、終局まで |
| L: 2 人・基本・ドラフト・Undo（UI 作成） | 542 手、**14,406 チェック / 失敗 0**、HTTP p95 3.9 ms、Undo 1 回 |
| L: 実サーバー再起動（対局中） | 再起動前後で fingerprint・stateKey 一致、履歴は継続（seq・branch 維持） |
| L: Docker Compose（Node 22） | ソロ（既定設定）を終局まで 77 手、**1,404 チェック / 失敗 0**、HTTP p95 5.7 ms、トレースはボリューム内に `tfm` 権限で出力 |
| L: タブレットで作成・プレイ中のゲーム（読み取り専用） | ソロ・企業時代、40 回×3 秒の照合で **806 チェック / 失敗 0**、HTTP p95 7.3 ms。タブレット操作による 14 判断が前後連鎖の途切れなく記録 |

## 3. シナリオ台帳

凡例: 結果 = PASS / PARTIAL（一部のみ検証） / 未実施。証跡はテスト名またはエビデンスファイル。

### 基本セット・ソロ（S01〜S15）

| ID | 事前条件 | 操作 | 期待結果 | 方法 | 結果 | 証跡 |
|---|---|---|---|---|---|---|
| S01 | 新規ソロ（基本のみ） | 作成直後に取得 | 世代1・研究、温度-30/酸素0/海洋0と上限、盤面全マス、`initialCards`（企業2or4・カード10）、ID 非含有 | C, L, B | PASS | `describes a new solo game`／UI の企業 4 枚（Thorgate, Ecoline, Interplanetary Cinematics, PhoboLog）と `choices.root.options[0].cards` が一致 |
| S02 | S01 | 企業1・カード2を選択 | 企業がタブローに、手札2枚、M€減、行動フェーズの `or` | C, N, L | PASS | `follows the corporation and initial card choice`、liveCheck 初手 |
| S03 | 研究フェーズ | 0枚購入 | 手札不変、`card` の `min:0` を尊重 | N, L | PASS | `buys no card and several cards in research` |
| S04 | 研究フェーズ（第2世代） | 2枚購入 | 購入数が反映、コスト減 | N | PASS | 同上（世代2で2枚） |
| S05 | 行動フェーズ・手札あり | カードをプレイ | タブロー追加・生産・タグ・M€ 反映 | C, N, L | PASS | `applies a played card`、liveCheck 全手で tableau/production を画面モデルと照合 |
| S06 | 条件不足・資金不足の手札 | 取得 | プレイ候補 `projectCard.cards` に**含まれない**／手札 `me.hand` には残る | C | PASS | `offers only the cards that can be played now`（Algae: 海洋5未満、Asteroid Mining: 30 M€ 不足） |
| S07 | Earth Catapult / Space Station をプレイ済み | 手札のコスト | 計算後コストが -2 / 宇宙タグのみ追加 -2、タブロー側に割引記述 | C | PASS | `shows discounted costs from Earth Catapult and Space Station`。実機対局では当該カード未出現のため L は未観測 |
| S08 | 生産あり | 世代終了 | 世代+1、M€=手持ち+生産+TR、植物、エネルギー→熱の順 | C, L | PASS | `reports production and its effect on the next generation`、liveCheck で production を毎手照合 |
| S09 | 植物8/熱8 | 緑化・温度上昇・標準プロジェクト | グローバルパラメータ・TR 反映 | N, L | PASS | autopilot が植物/熱変換を実行（ソロ実機で温度 8℃ 到達）、標準プロジェクトは Undo 試験と cancel 試験で実行 |
| S10 | タイル配置 | 緑地・都市・海洋 | タイル種別・所有者色・海洋は所有者なし・ボーナス名・隣接 | C, L | PASS | `shows tiles, owners and placement bonuses`、liveCheck でタイル数を毎手照合 |
| S11 | 青カード・カード上資源 | Tardigrades のアクション | 資源 3→4、`actionsUsedThisGeneration`、`selectBlueCardAction` ノード | C | PASS | `shows resources on cards and used actions`。L では tableau の資源数を毎手照合 |
| S12 | 行動フェーズ | 1手目・2手目・パス | `actionsTakenThisRound`、パス後 `hasPassed`、他者待ち | N, L | PASS | `takes first and second actions and passes`、2人対局で `waiting-for-others` を経由 |
| S13 | — | 世代遷移 | 全世代で研究→行動→生産、`version.generation/phase` 一致 | N, L | PASS | `passes through research, action and production of every generation`（14 世代） |
| S14 | 終局 | 最終得点 | `game-over`、VP known、`soloWin`、画面と VP 一致 | C, N, L, B | PASS | `reaches the end of the game`、実機ソロ: UI「Sorry, you lose.」⇔ `soloWin:false`、VP 36 |
| S15 | 任意 | 同一状態を連続取得 | fingerprint・stateKey 同一、`game.serialize()` 不変、`waitingFor` 同一、`gameAge` 不変 | C, A, L | PASS | `does not change the game when read`、`does not change the game when read repeatedly`、L で 1,600 回以上の二重読み取りが全一致 |

### 履歴・復元・複雑な選択（S16〜S24）

| ID | 事前条件 | 操作 | 期待結果 | 方法 | 結果 | 証跡 |
|---|---|---|---|---|---|---|
| S16 | 対局中 | ブラウザ再読み込み | 状態不変 | B, L | PASS | 2人対局でリロード・タブ切替後も fingerprint `7b35741e…` 不変 |
| S17 | 対局中 | サーバー再起動・セーブ復元 | 最終セーブ時点の状態を再現 | N, L | PASS | `rebuilds identical snapshots after a simulated restart`（InMemoryDatabase の最終セーブから復元し、セーブ直後に観測した fingerprint と一致）。実機: 対局中にプロセス再起動 → fingerprint・stateKey 一致。注意: Undo 無効のゲームは手番開始時しかセーブされない（gaps G-3） |
| S18 | Undo 有効 | 行動後に Undo | 内容は行動前と同じ fingerprint、stateKey は異なる、履歴に `revert`（branch 0→1） | N(route), L | PASS | `records undo as a new branch and returns to the same content`、実機: `evidence/sample-trace-undo.jsonl`（seq17 after = revert.to = `f0e268cc`、再実行 seq20 は branch 1） |
| S19 | 入れ子入力 | or/and/space/payment/card | path が回答インデックスと一致、型別項目 | U, N, L | PASS | `choices.spec.ts` 全件、autopilot が `choices` だけで回答し全局面を通過（space 選択含む） |
| S20 | トレース有効 | 回答・不正回答 | 判断前/後の参照、提示選択肢、応答、時刻、不正は `rejected` のみ | C, N(route), L | PASS | `records the state before and after an accepted answer`、`records a refused input only as rejected`、実機 decision 142+399・rejected 記録 |
| S21 | 対局中 | 当世代・過去世代ログ | 世代別取得、本人宛て行は本人のみ | L | PASS | 既存 `api/game/logs?generation=` を実機確認（各プレイヤーの非公開行は本人 ID のみ）。CoachState はログを含まない設計 |
| S22 | ドラフト/Prelude | 初期選択・ドラフト | 提示カード・min/max・選択後の手札 | C, L | PASS | Prelude: `shows the prelude choice of the opening`。ドラフト: 2人対局（Draft variant）で全ドラフト選択を autopilot が通過。Initial Draft variant は未実施 |
| S23 | 対局中 | 連続取得 | P95 < 200 ms | N, L | PASS | in-process p95 1.95 ms（73 回）、HTTP p95 4.38 ms（224 回）/ 3.92 ms（1,601 回） |
| S24 | — | カタログ | 全モジュール全カード（プロキシ除く）を一意に収録、基本セット全カード識別、安定版数 | U, L | PASS | `cardCatalog.spec.ts`、実機で手札・タブローの全カードがカタログに存在（毎手確認） |

### 対人・安全性（S25〜S31）

| ID | 事前条件 | 操作 | 期待結果 | 方法 | 結果 | 証跡 |
|---|---|---|---|---|---|---|
| S25 | 2人 | A 視点取得 | B の手札名・初期配布・ドラフト候補が JSON に現れない | C, L | PASS | `shows only public information about other players`、`keeps other players' dealt cards secret`、実機で毎手 B の `/api/player` 手札名と照合 |
| S26 | 2人 | A と B の取得 | A が見る B の公開項目 = B 自身の公開項目、盤面一致 | C, L | PASS | 同上（color/name/TR/資源/生産/タグ/手札枚数/タブロー/盤面）、実機で TR・手札枚数を画面モデルと照合 |
| S27 | 2人・VP 非公開 | 取得 | 相手 VP は `hidden`（0 ではない）、オプション有効時/終局時 `known` | C, A, L, B | PASS | `shows other players' VP when the option is on`、`keeps working for a finished game`、UI Players タブで相手 VP「?」⇔ `hidden` |
| S28 | — | 観戦者 ID で取得 | 400（コーチはプレイヤー専用） | A, L | PASS | `refuses spectator ids`、実機 liveCheck |
| S29 | — | 無効 ID・不正形式・Discord 不一致 | 400 / 404 / 403、fingerprint パラメータ検証 | A, L | PASS | `refuses a missing or malformed id`、`answers 404 for an unknown player id`、`enforces the Discord owner…`、`validates the fingerprint parameter` |
| S30 | タブレット | 画面遷移・回転 | 状態不変 | B, L | PASS | 内蔵ブラウザで 768×1024 縦 → 1024×768 横、タブ切替、再読込後も fingerprint 不変。実機タブレットはユーザーがゲーム作成・UI を確認（問題なし）。そのゲームを読み取り専用で照合し失敗 0（`evidence/live-tablet-solo-corpera-readonly.json`）。回転操作と fingerprint の同時記録は実機では行っていない |
| S31 | 2人 | 相手の行動 | 盤面・相手公開情報が更新、fingerprint 変化 | C, L | PASS | `updates the board after another player acts`、実機で相手手番後のタイル数・TR を画面モデルと照合 |

## 4. ブラウザ（UI）照合の記録

| 時点 | UI 表示 | CoachState |
|---|---|---|
| ソロ作成直後 | 企業 Thorgate / Ecoline / Interplanetary Cinematics / PhoboLog | `choices.root.options[0].cards` が同じ 4 枚、`options[1]` が 10 枚 |
| ソロ終局 | 「Sorry, you lose.」 | `soloWin: false`, `choices: game-over`, VP known 36 |
| 2人・世代29（横画面 Players タブ） | Green（Tharsis Republic, passed）628/28/28/28/1/55・VP「?」、You（CrediCor）8/33/28/4/96/31・VP 46 | 相手 `resources` 同値・`hasPassed:true`・`victoryPoints: hidden`、自分 同値・VP known 46 |
| 2人・世代29（縦画面 Mars） | Gen 29, O₂ 3%, 8℃, 海洋 1/9, 8 M€ | 同値 |

## 5. 既存テストへの影響

- 起点コミット（`fd22ef8b5`）: `test:server` 7,717 passing / 1 failing（`AI player › plays a complete game and beats a random player` が 60 秒タイムアウト）。単独実行でも同じく失敗 → 既存事象。
- 変更後: 7,772 passing / 1 failing（新規 55 件時点、AI タイムアウト）→ 最終 7,776 passing / 0 failing（新規 58 件、AI テストは 50.5 秒で成功）。既存テストの新たな失敗はなし。AI 対局テストは g10 で 50〜60 秒かかる時間依存テスト。
- クライアント: 起点コミットでも `App.spec.ts` 等の Vitest 環境 teardown で未処理エラー 1 件（読み込み対象ファイルは実行ごとに異なる）。テスト自体は 1,225 件すべて成功。

## 6. 最終実行ログ（g10, 2026-10-14）

```
npm run test:server   → 7776 passing (56s), 0 failing   [final, after Card getter]
                        (earlier run: 7772 passing, 1 failing: AI player timeout 60000ms)
coach specs only      → 58 passing (1s)
npm run test:client   → Tests 1225 passed (1225), Errors 1 (EnvironmentTeardownError; baseline also 1)
npm run build         → EXIT=0
eslint src tests      → OK
lint:i18n / lint:client(vue-tsc) → OK
lint:css              → 6 errors in existing .less files (baseline identical)
liveCheck solo        → answersSent 110, checks 1781, failed 0, HTTP p50 2.34 / p95 4.38 / max 40.0 ms
liveCheck 2p+undo     → answersSent 542, checks 14406, failed 0, HTTP p50 3.06 / p95 3.92 / max 12.1 ms
liveCheck final build → answersSent 40, checks 1088, failed 0, HTTP p95 5.02 ms (2p game, after restart)
```

ログ（g10）: `~/work/coach-logs/`（baseline-test-server.log, final-test-server.log, final-test-server2.log, test-client.log, baseline-client.log, lint3.log, build.log）
