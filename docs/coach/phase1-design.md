# Terraforming Mars AI Strategy Coach — Phase 1 最終設計

対象: `yusei88/terraforming-mars`（`wrybit/terraforming-mars` のフォーク）ブランチ `coach/phase1`
起点コミット: `fd22ef8b5`（2026-10-13 時点の wrybit `main`）

本書は実装済みコードに基づく設計である。データ項目の詳細は [phase1-data-catalog.md](phase1-data-catalog.md)、
テストは [phase1-qa.md](phase1-qa.md)、未対応事項は [phase1-gaps.md](phase1-gaps.md) を参照。

## 1. 方針

| 原則 | 実装での扱い |
|---|---|
| ゲーム本体への変更は最小限 | 本体は既存 5 ファイル +27/−1 行と新規 1 ファイル（入力オブザーバ、約 80 行）のみ。コーチ本体は `src/extensions/coach/` に置き、フォーク既存の拡張機構（`ServerExtension`）で登録する |
| ルールを再実装しない | 状態は `Server.getPlayerModel()`（プレイヤー画面と同じモデル）から投影。合法手は `waitingFor` だけを根拠にし、`canPlay()` などを独自に呼ばない |
| カード定義を重複管理しない | カタログは実行時にカードクラス（`ALL_MODULE_MANIFESTS`）から生成。手書きのカード表はない |
| 不明値を推測しない | `Observed<T>`（`known` / `hidden` / `unsupported`）、`effects.*Coverage`、`bespokeHooks`、`warnings` で欠損を明示 |
| 非公開情報を渡さない | 他プレイヤーは `PublicPlayerModel` 由来の公開項目のみ。プレイヤー/観戦者/ゲーム ID はスナップショットにも履歴にも含めない |
| 取得と分析の分離 | Phase 1 は取得・記録のみ。LLM 呼び出し・コンボ分析は含まない |
| 疎結合 | コーチが例外を投げてもゲームは継続（オブザーバは `try/catch` で隔離、API は 500 を返すだけ） |

## 2. 構成

```
src/server/extensions/inputObservers.ts      ← 新規（本体）: 回答・Undo の観測フック
src/server/extensions/ServerExtension.ts     ← 変更: inputObserver を追加
src/server/server/requestProcessor.ts        ← 変更: 拡張の inputObserver を登録
src/server/routes/PlayerInput.ts             ← 変更: 回答前後・Undo 前後で通知
src/server/routes/CancelAction.ts            ← 変更: アクション取消の前後で通知
src/server/cards/Card.ts                     ← 変更: 要件緩和効果の読み取り専用ゲッター（カタログ用）

src/extensions/coach/
  extension.server.ts          拡張の登録（ルート 3 本 + オブザーバ）
  common/CoachState.ts         CoachStateV1 の型（データ契約）
  common/CoachCatalog.ts       カードカタログの型
  common/CoachTrace.ts         判断履歴の型
  server/projectCoachState.ts  PlayerViewModel → CoachStateV1 の投影
  server/choices.ts            waitingFor（PlayerInputModel）→ CoachChoice 木
  server/cardCatalog.ts        カードクラス → カタログ（プロセス内キャッシュ）
  server/cardInstances.ts      CardModel → CoachCardInstance（動的値のみ）
  server/fingerprint.ts        正規化 JSON と SHA-256
  server/coachTrace.ts         判断履歴（JSONL）とオブザーバ
  server/routes.ts             HTTP ハンドラ
scripts/coach/liveCheck.ts     実サーバーに対する検証スクリプト
tests/extensions/coach/*.spec.ts  単体・統合・API・セキュリティ・通し試験
```

`npm run make:extensions` が `src/genfiles/extensionsServer.ts` に coach を登録する（`npm run build` に含まれる）。
`src/extensions/coach` を削除すればゲームは従来どおりビルド・動作する。

## 3. データ契約

### 3.1 CoachStateV1（`coach-state/1`）

```
{
  schemaVersion, fingerprint, stateKey, version, catalogVersion, capturedAt, warnings,
  game:      ゲーム設定・世代/フェーズ・グローバルパラメータ（値/最小/最大/残りステップ）・盤面・称号/褒賞・山札枚数・未対応部分
  me:        自分（公開項目 + 手札・ドラフト済み・初期配布・企業選択・autopass・取消可否）
  opponents: 他プレイヤー（公開項目のみ。VP は Observed）
  choices:   awaiting-input（root: CoachChoice 木） | waiting-for-others | resolving | game-over
}
```

- **静的/動的の分離**: カードは名前と動的値（計算後コスト、カード上の資源、割引、無効化、警告など）だけを持ち、
  コスト・タグ・要件・効果などの静的情報は `catalogVersion` が指すカタログで引く。
- **合法手と将来の可能性の区別**: 「今提示されている選択肢」は `choices` だけ。手札 `me.hand` はプレイ可否を
  持たない（プレイ可能なカードは `choices` 内の `projectCard` ノードの `cards` に限られる）。`me.dealt` は
  初期配布の履歴であり現在の提示ではない（エンジンが選択後も保持するため。§6 参照）。
- **非公開**: 相手の VP は `showOtherPlayersVP` が無効かつ対人戦中は `{status: 'hidden'}`（0 点とは表現しない）。
  ソロ・ゲーム終了・オプション有効時は `known`。判定条件は `Server.getPlayer` と同一。

### 3.2 状態識別

| 項目 | 意味 |
|---|---|
| `fingerprint` | `{game, me, opponents, choices}` の正規化 JSON（キー整列・`undefined` 除去）の SHA-256。時刻・バージョンカウンタ・タイマーを含まない。サーバー再起動で失われる値（`canCancelAction`、カードの一時警告 `warnings`）も除外 |
| `version.gameAge` | ログ行ごとに増える。Undo で戻る |
| `version.gameStep` | 最終 DB セーブ ID（`lastSaveId`）。Undo で戻る |
| `version.undoCount` | Undo・アクション取消の回数。**厳密な単調増加ではない**（DB から復元したゲームの値 +1 になるため、セーブを挟まない連続 Undo で同値になり得る） |
| `stateKey` | `<fingerprint 先頭16桁>:u<undoCount>:s<gameStep>:a<gameAge>`。同じ内容に Undo で戻った場合、fingerprint は同じで stateKey は異なる |
| 判断履歴の `branch` | Undo/取消が成功するたびに +1 する履歴側の分岐番号（単調増加。再起動後もファイルから復元）。`undoCount` の非単調性を補う |

### 3.3 選択肢（CoachChoice）

`waitingFor` の `PlayerInputModel` を再帰的に正規化する。各ノードは `path`（ルートは `""`、`or`/`and`/`initialCards`
の子は `"2"`, `"2.0"` …）を持ち、これはゲームが回答で期待するインデックス（`or.index`、`and.responses[i]`）と一致する。
対応型: `or` `and` `initialCards` `option` `card` `projectCard` `space` `payment` `player` `amount` `resource` `resources`。
その他（`colony` `party` `delegate` `productionToLose` など拡張由来）は `unsupported: true` と警告付きで素通しする。

テスト（`playthrough.spec.ts`・`liveCheck.ts`）は `choices` だけを読んで回答を組み立て、ソロゲームを最後まで
進められることを確認している。つまり `path` とノード情報は回答可能な精度を持つ。

### 3.4 カードカタログ（`coach-catalog/1`）

全モジュールのカード（企業・プロジェクト・プレリュード・CEO・標準プロジェクト/アクション、プロキシ除く）を
カードクラスから生成。機械可読部分と表示用テキストを分ける。

- `effects.onPlay` / `effects.action` / `effects.firstAction`: Behavior DSL（宣言的効果）をそのまま JSON 化
- `effects.staticEffects`: Behavior 以外のプロパティで宣言された効果（要件緩和 `globalParameterRequirementBonus`、
  TR の出所 `tr`、資源保護、隣接ボーナス、支払後の留保 `reserveUnits`、配置タイル `tilesBuilt`）
- `effects.playCoverage` / `actionCoverage`: `none` | `declarative` | `partial` | `bespoke`
- `effects.bespokeHooks`: カード固有のコード（`onCardPlayed`、`getCardDiscount`、`bespokePlay` など）。
  フレームワーク基底クラス（Card, ActionCard, CorporationCard 等）のメソッドは除外。ここに名前がある効果は
  **機械可読でない**ことを意味し、コーチは名前から効果を推測してはならない
- `display.description` / `display.cardNumber`: 人間向け。自動推論の根拠にしない
- `catalogVersion`: カタログ内容の SHA-256 先頭16桁。ビルド間で安定（テスト済み）

### 3.5 判断履歴（`coach-trace/1`）

既存の `humanDecisionTrace`（`AI_DECISION_LOG_DIR` 有効時のみ動作）は再利用を検討したが、以下の不足があるため
**並行する別記録**とした（既存機構は変更せずそのまま動く）。

| 要件 | 既存 humanDecisionTrace | coach-trace |
|---|---|---|
| 判断前の状態 | `PlayerSnapshot`（資源・手札名・タグ程度） | CoachStateV1 全体（fingerprint 参照、states ファイルに重複排除して保存） |
| 判断後の状態 | なし | `after` 参照（受理時のみ） |
| 不正入力 | 記録しない | `rejected` として別種で記録（判断としては数えない） |
| Undo・取消 | 扱いなし | `revert` イベント（from/to と branch） |
| 開始・終了時刻 | 経過ミリ秒のみ | `askedAt` / `decidedAt` / `thinkingMilliseconds` |
| ID | `gameId` を含む | ID を一切含まない（ファイル名のみサーバー側でゲーム ID を使用） |
| 記録器 | グローバルに 1 つ（AI 記録と共用） | 拡張オブザーバ。既存と独立 |

再利用した設計: 「回答処理前に状態を確定し、受理後にだけ書き込む」二段階コールバック（`prepareHumanDecision`
と同じパターン）、JSONL への追記・書き込み失敗を握りつぶす方針（`decisionLogFile.ts` と同じ）、ID のファイル名
サニタイズ。

保存先: 環境変数 `COACH_TRACE_DIR` が設定されたときのみ `<dir>/<gameId>.trace.jsonl` と
`<dir>/<gameId>.states.jsonl` に追記。未設定なら何もしない（オブザーバは即座に `undefined` を返す）。

## 4. API

| エンドポイント | 認可 | 内容 |
|---|---|---|
| `GET /api/coach/state?id=<playerId>` | `api/player` と同じ（秘密のプレイヤー ID + ゲームが Discord ユーザーに紐づく場合は本人/管理者） | CoachStateV1。`Cache-Control: no-store` |
| `GET /api/coach/catalog` | なし（`/cards` ページと同じ公開情報） | カタログ。`ETag` = catalogVersion、`If-None-Match` で 304 |
| `GET /api/coach/decisions?id=<playerId>[&fingerprint=<sha256>]` | state と同じ | 本人の履歴イベントのみ／本人が見たスナップショット 1 件。他プレイヤーのイベント・スナップショットは返さない |

観戦者 ID・不正形式 ID は 400、存在しない ID は 404、Discord 不一致は 403。読み取りはゲームを変更しない
（`game.serialize()` の前後一致をテストで確認）。`ipTracker.addParticipant` も呼ばない（読み取りの副作用を避ける）。

## 5. 本体への変更（差分の要点）

1. `inputObservers.ts`（新規）: `observeInput(player, response, ms)` と `observeRevert(player, kind)`。
   登録された全オブザーバを呼び、例外はログに出して無視。
2. `PlayerInput.ts`: `player.process()` を `try/catch` で囲み、失敗時は `{accepted:false}` を通知してから
   **元の例外を再スロー**（従来のエラー応答は不変）。Undo では復元前に通知を開始し、復元結果（失敗時は undefined）を渡す。
3. `CancelAction.ts`: 取消（`actionStart.ts` のスナップショット復帰）の前後で同様に通知。
4. `ServerExtension.ts` / `requestProcessor.ts`: 拡張が `inputObserver` を提供できるようにし、ルートと同じループで登録。
5. `Card.ts`: `globalParameterRequirementBonus` の読み取り専用ゲッターを追加（Adaptation Technology / Special Design の
   効果がカタログから見えなかったため。自己レビューで発見）。

既存の `humanDecisionTrace` の呼び出し順は変えていない。

## 6. ソース調査で判明した事実と設計への反映

| 事実 | 根拠 | 反映 |
|---|---|---|
| `api/game?id=<gameId>` は全プレイヤー ID を返す | `ApiGame` → `getSimpleGameModel` | ゲーム ID もプレイヤー ID と同等の秘密として扱い、出力しない |
| `dealtCorporationCards` 等は選択後もクリアされない | `Player.ts`/`Draft.ts` に再代入のみ | `me.dealt` を「履歴」と定義し、現在の提示は `choices` のみ |
| 研究フェーズは「セーブ → 配布」の順 | `Game.gotoResearchPhase()` | 再起動で配布は同じ山札上から再実行され、同じ提示になる（実測一致） |
| Undo なしのゲームはラウンド開始時にしかセーブしない | `Player.takeAction()` | 再起動すると手番開始まで巻き戻る。コーチは巻き戻った状態をそのまま報告（fingerprint はセーブ時点と一致） |
| `undoCount` は単調でない | `GameLoader.restoreGameAt()` が DB 値に +1 | 履歴側で単調な `branch` を持つ |
| `getPlayerModel()` は取消可否判定のため毎回ゲーム全体をシリアライズする | `actionStart.canCancelAction` | 性能を実測（後述）。問題なし |
| `api/game/logs` は Discord 紐付けを確認しない | `ApiGameLogs` | 既存のリスクとして gaps に記録（コーチはログを返さない） |
| 終局時に「This game id was …」がログに出る | `Game.gotoEndGame()` | 終局後は ID が公開扱い（`PublicPlayerModel.id` も END で公開）。コーチは引き続き ID を出さない |
| 他プレイヤーの VP は END・ソロ・オプション時のみ実値、それ以外はゼロ埋め | `Server.getPlayer` | ゼロ埋めを `hidden` に変換 |

## 7. 性能

- 単体（in-process）: ソロ 14 世代の通し試験で 73 回取得、p50 1.45 ms / p95 1.95 ms / 最大 2.18 ms（g10）
- HTTP 経由（g10 ローカル）: ソロ p95 4.38 ms（224 回）、2 人 p95 3.92 ms（1,601 回）。詳細は [phase1-qa.md](phase1-qa.md)
- カタログは初回生成後プロセス内でキャッシュ（約 1,000 枚、初回約 170 ms）
