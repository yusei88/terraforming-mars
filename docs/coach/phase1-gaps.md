# Phase 1 — 未対応・未検証・リスク・Phase 2 への申し送り

## 1. 実機で未検証の項目

| ID | 項目 | 状況 | 実施手順 |
|---|---|---|---|
| V-1 | Docker Compose 上での動作 | **実施済み（2026-10-14）**。初回ビルドは `scripts/coach/liveCheck.ts` が `tests/`（`.dockerignore` で除外）を参照して webpack の型検査で失敗 → 自動回答を `scripts/coach/autopilot.ts` に移して解消。ソロ終局まで照合失敗 0 | トレースは compose の上書きで `COACH_TRACE_DIR=/usr/src/app/db/coach-trace` を設定（`tm-db` ボリューム内）。検証後コンテナは停止（ボリュームは保持） |
| V-2 | 実機タブレット（S30） | ユーザーがタブレットでゲーム作成・プレイし UI 問題なし。そのゲームを読み取り専用で照合し失敗 0 | 回転の前後で `fingerprint` を記録する厳密な確認は任意 |
| V-3 | Initial Draft variant | 未実施（ドラフトは通常ドラフトのみ実機確認） | 新規作成画面で Initial Draft を有効にし `liveCheck.ts` を実行 |
| V-4 | 企業時代（Corporate Era）有りの実機対局 | タブレットのゲーム（企業時代あり）を読み取り専用で照合済み、Docker の既定設定（企業時代・プレリュードあり）で終局まで照合済み | — |
| V-5 | AI 対戦相手を含む対局 | 未実施（AI の判断は既存 `decisionTrace` が記録、coach-trace は人間のみ） | AI 1 体を入れて作成し `liveCheck.ts` に人間の ID のみ渡す |

## 2. データ欠落・制約

| ID | 内容 | 影響 | 対応方針 |
|---|---|---|---|
| D-1 | カード効果の機械可読範囲（基本セット 148 枚） | 宣言的 105 / 一部コード併用 9 / コードのみ 7 / Behavior なし 27（うち 4 枚は VP のみ、残りは `staticEffects`・`cardDiscount`・フックで表現）。青カードアクション 23 枚中 20 が宣言的、3 がコードのみ。VP `special` 1 枚 | `bespokeHooks` を持つカードは効果をテキストでしか判断できない。Phase 2 は推測で埋めず、対象カードの効果を人手で構造化するか「未解析」として扱う |
| D-2 | 手札カードの「あと何が足りないか」 | 未提供。プレイ可否は `choices`（今プレイできるもの）だけ | 要件はカタログ `requirements`、現在値は `game.*` と `me.tags` にある。差分計算は Phase 2 で実装（`canPlay()` は警告付与の副作用があるため呼ばない方針。必要ならシミュレーション用コピーで評価） |
| D-3 | `card` 選択で他プレイヤーのカードが提示される場合の所有者 | `CardModel` に所有者がなく、`CoachCardInstance` にも含めていない | 盤面の各プレイヤー `tableau` と名前で突き合わせれば判定可能（カードは一意）。必要なら Phase 2 で付与 |
| D-4 | 未正規化の入力型 | `colony` `delegate` `party` `productionToLose` `aresGlobalParameters` `globalEvent` `claimedUndergroundToken` `deltaProject` は `unsupported: true` で素通し（警告あり） | 基本セットでは未出現。拡張対応時に追加 |
| D-5 | 拡張固有の状態 | Venus はスケール値のみ。コロニー・ターモイル・月・パスファインダー・アレス・アンダーワールド等は `game.unsupported` と警告で明示し、値は出さない | 拡張ごとに Phase 2 以降 |
| D-6 | ゲームログ | CoachState に含めない（既存 `api/game/logs` を利用） | Phase 2 で振り返りに必要なら、本人宛て行のフィルタを維持して要約を取り込む |
| D-7 | 判断後状態の範囲 | `after` は回答直後に本人が見られる最初の状態。AI 相手の自動手番や生産フェーズが進んだ後の場合がある | `after.version` の世代・フェーズで区別できる |
| D-8 | `title` は英語原文 | 翻訳はクライアント側のため | 表示用途では i18n キーとして扱う |

## 3. 判明した本体側の挙動（コーチ側で吸収済み・注意事項）

| ID | 挙動 | コーチでの扱い / 残リスク |
|---|---|---|
| E-1 | `undoCount` は単調増加しない（復元したセーブの値 +1） | 履歴側の `branch`（単調）で補完。stateKey 単独での分岐判定は不可 |
| E-2 | Undo 無効のゲームは手番開始時（`actionsTakenThisRound === 0`）しかセーブしない | **サーバー再起動で手番開始まで巻き戻る**。CoachState は巻き戻った状態を正しく返すが、**判断履歴には巻き戻りイベントが記録されない**（再起動前の判断が残る）。Phase 2 で「`gameStep` が履歴上の最新より小さい状態を観測したら restart-rollback として扱う」検出が必要 |
| E-3 | 研究フェーズは「セーブ → 配布」 | 再起動で同じ山札上から再配布され提示は同一（試験で確認） |
| E-4 | `dealt*Cards` は選択後もクリアされない | `me.dealt` は履歴と明記。現在の提示は `choices` のみ |
| E-5 | `Server.getPlayerModel()` は取消可否判定のため毎回ゲーム全体をシリアライズ | 実測 p95 2〜4 ms で問題なし。プレイヤー数・拡張が増えた場合は再測定 |
| E-6 | テスト用 `InMemoryDatabase.saveGameResults` が未実装で例外 | 通し試験ではサブクラスで無効化。既存テスト基盤の制約 |

## 4. セキュリティ上の注意

| ID | 内容 | 対策 / 推奨 |
|---|---|---|
| S-1 | プレイヤー URL の ID が唯一の認可（Discord 連携しない限り）。コーチ API も `api/player` と同じ強度 | ID を知る者は手札を読める（既存と同等）。ID を共有しない。ゲーム ID も同等の秘密（`api/game` が全プレイヤー ID を返す） |
| S-2 | LAN 上は HTTP 平文。ufw で `192.168.3.0/24` に 8081 を開放済み | 同一 Wi-Fi 上の盗聴で ID が漏れ得る。インターネットへ公開しない。公開するなら HTTPS リバースプロキシ必須 |
| S-3 | レート制限なし | 読み取り専用で 1 回数 ms だが、ID 総当たり対策は既存と同じく無し（ID は 12 桁 16 進） |
| S-4 | 判断履歴ファイルは全プレイヤーの非公開状態（手札）を含む | ファイルシステム権限で保護（サーバー実行ユーザーのみ）。API は本人分だけ返す。保持期間・削除方針は未定（Phase 3 で決定） |
| S-5 | 既存 `api/game/logs` は Discord 紐付けゲームでも本人確認をしない | 既存の問題。コーチはログを返さないため影響なし。修正は本体側の別タスク |
| S-6 | 終局時のログに「This game id was …」が出る、終局後は `PublicPlayerModel.id` も公開 | 既存仕様（終局後は公開扱い）。コーチは終局後も ID を出さない |
| S-7 | AI プレイヤーの ID でもコーチ状態を取得できる（警告 `ai-player` 付き） | `api/player` でも同じ情報が見えるため新たな漏えいではない |

## 5. 運用上の制約

- トレース容量: 2 人・542 手で `states.jsonl` 約 11 MB、`trace.jsonl` 約 1.2 MB。ローテーション・圧縮なし。
- `GET /api/coach/decisions?fingerprint=` は states ファイル全体を同期的に読む（大きいゲームで数十〜百 ms、イベントループを塞ぐ）。頻繁に呼ぶ用途は Phase 2 で索引化が必要。
- 再起動後の最初の記録時に既存トレースファイルを 1 回読み込む（seq・branch の復元）。
- `COACH_TRACE_DIR` 未設定ではトレースしない（既定オフ）。`AI_DECISION_LOG_DIR`（既存）とは独立。

## 6. 既存の失敗（本変更と無関係・起点コミットで再現）

- `assets/ma/physicist.png` がリポジトリに無く、Physicist 褒賞の画像要求が 500 になる（サーバーログで確認。コーチとは無関係）

- `tests/ai/aiPlayer.spec.ts › plays a complete game and beats a random player`: g10 で 50〜60 秒かかる時間依存テスト。起点コミット・単独実行でも 60 秒タイムアウトで失敗することがある（最終実行では成功）
- `npm run lint:css`: 既存 .less 4 ファイルで 6 件
- `npm run test:client`: Vitest の環境 teardown で未処理エラー 1 件（テストは全件成功）

## 7. Phase 2 へ移行するための条件と申し送り

**移行条件**
1. ~~V-1（Docker Compose）~~ 実施済み
2. ~~V-2（実機タブレット）~~ 実施済み
3. E-2 の巻き戻り検出方針を決めること（Undo を有効にしてプレイする運用なら実害は小さい）

**Phase 2 で必要な追加開発**
1. Behavior DSL の要約器（生産・資源・タイル・TR の差分を機械的に算出）と、`bespokeHooks` カードの扱い（人手構造化 or 未解析表示）
2. 要件充足の差分計算（D-2）
3. 数世代先の資源・生産シミュレーション（ゲームコピー上で評価する場合は既存 `src/server/ai/simulationSandbox.ts` の再利用を検討）
4. LLM へ渡すデータの選別（CoachState 全体は 13〜46 KB。盤面ジオメトリ等の静的部分は除外して要約）
5. restart-rollback 検出（E-2）とトレース索引化（§5）
6. 判断履歴の閲覧 UI（翻訳 16 言語の同時追加が必要：CLAUDE.md の fork rule）
