# CoachStateV1 データカタログ

各項目の取得元・公開範囲・欠損時の扱い。型定義は `src/extensions/coach/common/CoachState.ts`。
「取得元」の `view` は `Server.getPlayerModel(player)`（プレイヤー画面が受け取る PlayerViewModel）、
`game` はサーバー内部の `IGame`（公開情報のみ参照）。

公開範囲: **公開** = 全員が見られる情報 / **本人** = リクエストしたプレイヤーのみ / **条件付** = ルール上の条件で公開。

## 1. 識別・品質

| 項目 | 取得元 | 公開範囲 | 備考 |
|---|---|---|---|
| `schemaVersion` | 固定 `coach-state/1` | — | |
| `fingerprint` | 正規化した `{game, me, opponents, choices}` の SHA-256 | — | `warnings`・`canCancelAction`・時刻・カウンタは除外 |
| `stateKey` | fingerprint + undoCount + gameStep + gameAge | — | 同内容でも履歴位置が違えば異なる |
| `version.generation` / `phase` | `view.game` | 公開 | |
| `version.gameAge` | `view.game.gameAge` | 公開 | ログ行数。ポーリング（`api/waitingfor`）と同じ値 |
| `version.gameStep` | `view.game.step`（= `lastSaveId`） | 公開 | |
| `version.undoCount` | `view.game.undoCount` | 公開 | 非単調（設計書 §3.2） |
| `catalogVersion` | カタログ内容のハッシュ | 公開 | |
| `capturedAt` | サーバー時刻 | — | fingerprint に含めない |
| `warnings[]` | 投影処理 | — | `expansion-not-supported` / `input-type-not-supported` / `card-not-in-catalog` / `ai-player` / `game-over` |

## 2. ゲーム共通（`game`）

| 項目 | 取得元 | 公開範囲 | 備考 |
|---|---|---|---|
| `name` | `view.game.name` | 公開 | |
| `mode` / `playerCount` | `game.isSoloMode()` / `game.players.length` | 公開 | |
| `board` | `gameOptions.boardName` | 公開 | |
| `expansions` | `gameOptions.expansions` | 公開 | 全拡張の有効/無効 |
| `baseGameOnly` | 投影 | — | 基本（+企業時代）のみなら true。プレリュードありは false |
| `options.*` | `gameOptions` | 公開 | ドラフト、VP 公開、Undo、ソロ TR、高速モード、ランダム称号褒賞 |
| `generation` / `phase` | `view.game` | 公開 | |
| `lastSoloGeneration` | `view.game.lastSoloGeneration` | 公開 | |
| `activePlayer` / `firstPlayer` | `game.activePlayer.color` / `game.first.color` | 公開 | 色で表す（ID ではない） |
| `passedPlayers` | `view.game.passedPlayers` | 公開 | |
| `temperature` / `oxygen` / `oceans` | `view.game` + `game.max` + 定数 | 公開 | `{value, min, max, stepsRemaining}`。最大値はマップ別（アマゾニス等） |
| `venus` | `game.getVenusScaleLevel()` | 公開 | Venus Next 有効時のみ存在 |
| `isTerraformed` | `view.game.isTerraformed` | 公開 | |
| `gameOver` | `phase === 'end'` | 公開 | 最終生産中（`resolving`）は false |
| `soloWin` | `view.game.isSoloModeWin` | 公開 | ソロかつ終了後のみ存在 |
| `decks.*` | `view.game.deckSize` 等 | 公開 | 枚数のみ。**山札の順序・中身は出さない** |
| `spaces[]` | `game.board.spaces` + `view.game.spaces` | 公開 | `id, x, y, spaceType, bonus(名前), adjacent(隣接ID), tile{type, ownerColor}, ownerColor, highlight`。海洋は所有者なし（`getColor` と同じ規則） |
| `milestones[]` | `view.game.milestones` | 公開 | `claimedBy`（色）、`threshold`、各プレイヤーの `score/claimable`（画面と同じ公開情報） |
| `awards[]` | `view.game.awards` | 公開 | `fundedBy`、各プレイヤーの `score` |
| `unsupported[]` | 投影 | — | 有効だが正規化していない拡張とその理由 |

## 3. プレイヤー（`me` と `opponents[]` 共通の公開項目）

| 項目 | 取得元（PublicPlayerModel） | 公開範囲 | 備考 |
|---|---|---|---|
| `color` / `name` | `color` / `name` | 公開 | ID は含めない |
| `isAi` | `game.players[].aiLevel` | 公開 | |
| `isActive` / `hasPassed` | `isActive` / `passedPlayers` | 公開 | |
| `terraformRating` | `terraformRating` | 公開 | |
| `victoryPoints` | `victoryPointsBreakdown` | 条件付 | 本人・ソロ・終了後・`showOtherPlayersVP` で `known`、それ以外 `hidden` |
| `resources` | `megacredits, steel, titanium, plants, energy, heat` | 公開 | |
| `production` | `*Production` | 公開 | |
| `steelValue` / `titaniumValue` | 同名 | 公開 | 割増（Advanced Alloys 等）込み |
| `tags` | `tags`（0 を除外） | 公開 | イベントタグはプレイ済みイベントの扱いに従う（エンジン準拠） |
| `cardsWithoutTags` | `noTagsCount` | 公開 | |
| `cardsInHandCount` | `cardsInHandNbr` | 公開 | 他プレイヤーは**枚数のみ** |
| `corporations` | `tableau` のうちカタログで CORPORATION のもの | 公開 | |
| `tableau[]` | `tableau`（`showResources: true`） | 公開 | 名前・カード上資源・割引・無効化。プレイ済みイベントを含む |
| `actionsUsedThisGeneration` | `actionsThisGeneration` | 公開 | 使用済み青カードアクション |
| `actionsTakenThisRound` | 同名 | 公開 | 今回の手番での行動数（1手目/2手目の判定） |
| `availableBlueCardActionCount` | 同名 | 公開 | エンジンが「今使える」と判定した数 |
| `citiesCount` | 同名 | 公開 | |
| `cardCost` | 同名 | 公開 | 研究フェーズの購入単価 |
| `protectedResources` / `protectedProduction` | 同名 | 公開 | |
| `lastCardPlayed` | 同名 | 公開 | |
| `needsToResearch` / `needsToDraft` | 同名 | 公開 | |

## 4. 本人のみ（`me`）

| 項目 | 取得元 | 備考 |
|---|---|---|
| `hand[]` | `view.cardsInHand`（計算後コスト付き） | `calculatedCost` は割引適用後。**プレイ可否は含まない**（`choices` を参照） |
| `preludesInHand[]` / `ceosInHand[]` | 同名 | |
| `draftedCards[]` | `view.draftedCards` | ドラフト済み・未購入 |
| `dealt.corporations / preludes / projects / ceos` | `view.dealt*Cards` | 初期配布の**履歴**。選択後も残る |
| `pickedCorporation` | `view.pickedCorporationCard` | |
| `autopass` | `view.autopass` | |
| `canCancelAction` | `view.canCancelAction` | 再起動で失われる値。fingerprint から除外 |

## 5. カードインスタンス（`CoachCardInstance`）

| 項目 | 取得元（CardModel） | 備考 |
|---|---|---|
| `name` | `name` | 静的情報はカタログで引く |
| `calculatedCost` | `calculatedCost` | 手札・ドラフト・購入候補・プレイ候補のみ |
| `resources` | `resources` | タブローのみ |
| `discount` | `discount` | Crescent Research / Mars Direct の動的割引も反映 |
| `isDisabled` | `isDisabled` | Pharmacy Union 等 |
| `warnings` | `warnings` | 一時的な注意（fingerprint 対象外） |
| `additionalProjectCosts` / `reserveUnits` / `bonusResource` / `cloneTag` | 同名 | 拡張由来の付帯情報 |
| `inCatalog` | カタログ照合 | false なら `card-not-in-catalog` 警告 |

## 6. 選択肢（`choices`）

| 状態 | 意味 |
|---|---|
| `awaiting-input` | 本人に質問が出ている。`root` 以下が**今この瞬間の合法な選択肢のすべて** |
| `waiting-for-others` | 他プレイヤーの回答待ち（`waitingFor` に色） |
| `resolving` | 誰にも質問がない（最終生産など自動処理中） |
| `game-over` | 終了 |

`CoachChoice` の型別項目:

| inputType | 項目 |
|---|---|
| `or` | `options[]`, `initialIndex` |
| `and` / `initialCards` | `options[]`（すべてに回答） |
| `option` | （`warnings`） |
| `card` | `cards[]`（選べるカードのみ）, `min`, `max`, `selectBlueCardAction` |
| `projectCard` | `cards[]`（**今プレイ可能なカードのみ**、計算後コスト付き）, `paymentOptions`, `spendableCardResources` |
| `space` | `spaces[]`（合法なマスのみ）, `tile` |
| `payment` | `amount`, `paymentOptions`, `spendableCardResources` |
| `player` | `players[]`（色） |
| `amount` | `min`, `max`, `maxByDefault` |
| `resource` / `resources` | `include` / `count` |
| その他 | `unsupported: true` + 警告 |

共通: `path`, `inputType`, `title`（プレースホルダ展開済み英語）, `buttonLabel`, `optional`, `warnings`。
`sourceCard`（質問の発生源カード）は `choices.sourceCard`。

## 7. カタログ（`/api/coach/catalog`）

| 項目 | 取得元 | 備考 |
|---|---|---|
| `name, module, type, tags, cost, requirements, victoryPoints, resourceType, cardDiscount, startingMegaCredits, cardCost, compatibility` | カードクラスの静的プロパティ | `requirements` は正規化済み記述子 |
| `effects.onPlay / action / firstAction` | `behavior` / `actionBehavior` / `firstAction` | Behavior DSL の JSON |
| `effects.productionBox` | `behavior.production` が固定値のとき | |
| `effects.staticEffects` | `globalParameterRequirementBonus`, `tr`, `protectedResources`, `adjacencyBonus`, `reserveUnits`, `tilesBuilt` | Behavior 以外で宣言された効果（例: Adaptation Technology の要件緩和） |
| `effects.playCoverage / actionCoverage` | 宣言とカード固有コードの有無 | `declarative` 以外は完全には機械可読でない |
| `effects.bespokeHooks` | カードクラス固有メソッド名 | 例: `onCardPlayed`, `getCardDiscount`, `bespokePlay`, `onTilePlaced` |
| `effects.hasAction` | `isIActionCard` | |
| `display.description / cardNumber` | `metadata` | 表示用。`renderData`（描画 DSL）は含めない |

## 8. 取得しないもの（意図的）

| 情報 | 理由 |
|---|---|
| プレイヤー ID・観戦者 ID・ゲーム ID | アクセス権そのもの（ゲーム ID から全プレイヤー ID が引ける） |
| 他プレイヤーの手札内容・ドラフト候補・初期配布・企業候補 | 非公開 |
| 山札・捨て札の順序と中身 | 非公開（枚数のみ） |
| 乱数シード | 将来の引きを推測できる |
| タイマー | 時刻依存。状態内容ではない |
| ゲームログ | 既存 `api/game/logs` を利用（本人宛てログのフィルタ済み）。Phase 2 で必要なら要約して取り込む |
| 個々のカードのプレイ可否（手札全体について） | `canPlay()` は副作用（警告付与）があり、合法手は `choices` で十分 |
