# Phase 2 設計（実装済み部分）— G0 + Gate A〜E

計画: `TM-COACH-P2`（2026-10-14）。ブランチ `coach/phase2`、起点 `7ee0c64bb`（`main`、内容は `ef8bc6664` と同一）。
最初の PR（#2、マージ済み）で **G0 修正・効果原子（EffectAtom）と未解析の表現・要件分析・実エンジンとの Golden** を入れた。
続く PR（#3、マージ済み）で **Gate B: コンボの有向グラフ** を追加（§7）。
PR #4（マージ済み）で **Gate C: プラン候補の列挙** を追加（§8）。
PR #5（マージ済み）で **Gate D: 生産フェーズ 0〜3 回の予測** を追加（§9）。
ブランチ `coach/phase2-gate-e`（起点 `2b8d5abf7`）で **Gate E: `CoachAnalysisV1` と `GET /api/coach/analysis`** を追加（§10）。Gate F は未着手。

関連: [カバレッジ監査](phase2-coverage.md) / [QA](phase2-qa.md) / [未対応](phase2-gaps.md) / [報告](phase2-report.md)

## 1. G0: Phase 1.5 の修正

| 問題 | 修正 | 試験 |
|---|---|---|
| `readEvents()` が読込エラーを無視し、空履歴を `valid` と判定し得た | 読込結果にエラーを持たせ、`assess()` は `uncertain`（理由にエラー種別）、`eventsOf()` は `{events: [], error}`、`historySnapshot()`・`lastConfirmed()` は undefined。読めない履歴の上には**書き込まない**（seq の重複を防ぐ。件数は `health.historyReadFailures`） | P2-17 |
| `historySnapshot()` が advisory 不一致のとき別のスナップショットへフォールバックした | 新形式の参照（`advisoryFingerprint` あり）は完全一致のみ。フォールバックは Phase 1 の参照（advisory なし）だけ `legacy-content-only` | P2-18 |

API: `GET /api/coach/decisions` は履歴が読めないとき `historyReadError` を返す。`TraceSink.readMatching()` も `ReadResult` を返す契約に変更。

## 2. 効果原子（`coach-mechanics/1`、`common/CoachMechanics.ts`）

カタログのカード 1 枚を、**固定値で表せる効果（EffectAtom）**と、**計算しない効果（UnmodeledEffect、理由付き）**に分ける。

| EffectAtom | 由来 |
|---|---|
| `stock` / `production` / `spend` | Behavior の `stock` / `production` / `spend` の固定値 |
| `tr` | `tr` の固定値 |
| `global`（temperature/oxygen） | `global` の固定値。TR・上限・ボーナスはゲーム側の規則として別扱い |
| `drawCard` | 枚数のみ（内容は未知） |
| `addResourcesHere` | `addResources` の固定値 |
| `cardDiscount` | カードの `cardDiscount`（タグ／全カード、per tag/card） |
| `requirementBonus` | `globalParameterRequirementBonus`（パラメータ指定なし） |
| `alloyValue` | `steelValue` / `titanumValue` |
| `startingMegaCredits` / `researchCardCost` | 企業の開始 M€・研究時のカード価格 |
| `victoryPoints` / `victoryPointsPerResource` | 固定 VP、カード上の資源あたり VP |
| `victoryPointsPerTag`（Gate B で追加） | タグあたり VP。本体の採点と同じく自分のタグ（ワイルドなし・カード自身を含む）、`all` なら相手のタグも |

UnmodeledEffect の種類: `choice`（or）、`countable`（式で決まる量）、`target-choice`（対象を選ぶ）、`tile-placement`、`bespoke-code`（カード固有コード）、`conditional-cost`、`special-vp`、`unknown-key`、`other`。
未知の Behavior キーは `unknown-key` として必ず出る（テストで 0 件を固定し、新カード追加時に検知）。

分類（`support`）: 全効果が原子 → `supported`、一部 → `partial`、原子なし → `unsupported`、効果なし → `none`。
**`supported` と判定したカードは、実エンジンで全件検証している**（§5）。一部だけ分かるカードに合計値を付けない。

カード固有コードのうち、プレイ可否だけを変えるもの（`bespokeCanPlay` など）は効果ではなく要件側の「評価不能」に計上し、タイル配置関連（`getAvailableSpaces` など）はタイル配置の未解析に含める。

## 3. 要件分析（`analysis/requirements.ts`）

`RequirementGap`（`common/CoachAnalysis.ts`）を CoachState だけから計算する。規則は本体 `src/server/cards/requirements/` に合わせた。

| 要件 | 観測値 |
|---|---|
| タグ（最小） | 自分のタグ + ワイルドタグ（`all` なら相手の公開タグも、ワイルドなし） |
| タグ（最大） | ワイルドなし |
| 温度・酸素・海洋（最小） | 現在値 + 要件緩和×刻み（温度は 1 段 = 2 ℃） |
| 同（最大） | 現在値 − 要件緩和×刻み。超過したら `permanentlyUnmet`（下がらないため） |
| 要件緩和 | 場のカードの `requirementBonus`。Special Design は直前にプレイした場合のみ |
| 生産・TR | 自分の値 |
| 緑地・都市 | 盤面のタイル（都市は CITY/CAPITAL ほか、`all` は中立含む全員） |

`conditional`: 規則を変えるカード（Earth Embassy・Habitat Marte・Odyssey・Chimera）や分析対象外の拡張がある場合。`unsupported`: 隣接条件、カード固有のプレイ条件など。
合法性の正本は引き続き `CoachState.choices`。要件分析は「何が足りないか」の説明用。

## 4. 割引（`analysis/discounts.ts`）

`costAfterDiscount(state, 対象カード, 割引カード)` = `max(0, エンジンが今計算したコスト − 新しい割引)`。per tag は対象カード自身のタグ数（ワイルドは数えない）、per card は 1 回。割引がカード固有コード（`getCardDiscount`）なら `unknown`。

## 5. Golden（実エンジンとの差分試験、テスト専用ゲームのみ）

| 試験 | 方法 | 結果 |
|---|---|---|
| 割引 | 基本・企業時代の割引カード 10 種それぞれについて、Earth Catapult 適用済みの状態で全プロジェクトカード（約 208 枚）のコストを予測 → エンジンで割引カードをプレイ → `getCardCost` と照合 | 全件一致 |
| 下限 0 | 最安カードに Earth Catapult + Anti-Gravity Technology | 予測 0 = エンジン 0 |
| プレイ時効果 | `supported` の全プロジェクトカードをエンジンでプレイし、資源・生産・TR・手札枚数・カード上資源・温度・酸素・鋼鉄/チタン価値の差分を予測と照合 | 全件一致 |
| アクション | `supported` で原子のアクションを持つ全カードをエンジンで実行し、支払・獲得・生産・TR・ドロー・カード上資源・酸素を照合 | 全件一致 |
| 企業 | `supported` の全企業をエンジンで選択し、開始 M€・生産・研究カード価格を照合 | 全件一致 |
| 要件 | 基本・企業時代で評価可能な要件を持つ全カードについて、3 つの局面で要件充足をエンジンのコンパイル済み要件と照合 | 全件一致（150 件以上） |

ミューテーション確認: ワイルドタグの無視、タグ割引の全カード適用、`global` キーの無視の 3 つを入れるとそれぞれ試験が失敗することを確認。

## 6. 原子化した効果の正しさの範囲

Gate B で、アクションの Golden を「`supported` カード」から「アクション部分に未解析がない全カード」に広げた（`partial` カードのアクションも検証）。
カード固有コードのフックは影響先で分類する: `action`/`canAct` 系 → `action`、`bespokePlay` 系 → `onPlay`、その他 → `static`（以前はすべて `static` だったため、アクションがコードのカードを「アクション解析済み」と誤認し得た）。
VP の Golden: VP を原子化した全カードについて、タグ・カード上資源の 3 状態でエンジンの `getVictoryPoints` と一致。

## 7. Gate B: コンボの有向グラフ（`analysis/synergyGraph.ts`）

ノード: `played`（場）、`hand`（手札・プレリュード手札）、`offered`（ドラフト済み・`choices` で提示中のカード）。同名は played > hand > offered。カタログ全体の参考例（catalog-only）は未実装。

| エッジ | 根拠 | 条件 |
|---|---|---|
| UNLOCKS | A のタグ（イベントは場でタグを持たないので除外、最小要件ならワイルドも）・`global` 原子（トラックの残り段数で上限）・生産原子が、B の未充足の最小要件を縮める | A・B とも未プレイ。`completes`＝A だけで満たす |
| DISCOUNTS | A の割引原子が B のコストを下げる | 未プレイ A: 予測後コスト（下限 0）。場の A: `alreadyApplied`（現在コストに含み済み）。現在コスト 0 なら金額を主張しない |
| PRODUCES_FOR | A が鋼鉄を与え B が建物タグ／チタンと宇宙タグ／A が与える資源を B のアクションが消費 | M€ は全カードに効くため結ばない |
| SCORING | A のタグ（イベント除く）が B のタグ VP を増やす | 増分 VP>0 のみ。終局まで B が場にある前提で `conditional` |
| CONFLICTS_WITH | A の `global`/タグが B の最大要件を超えさせる（`playFirst`=B）、A の生産減少が B の生産要件を割る、両カードのアクションが同じ資源（M€ 以外）を消費 | 温度は 1 段 2 ℃ |
| FEEDS_RESOURCE / AMPLIFIES | 生成しない（`notProduced` に理由） | 検証済みアダプタなし |

**同じタグを持つだけでは結ばない**（効果・要件・規則への実際の接続が必須。テストで固定）。
`support`: 要件が `conditional` か、A が `partial`（未解析の効果を他に持つ）なら `conditional`（前提を列挙）。タグ・割引・支払規則は `verified`。
`limitations`: 海洋要件（タイル配置は未解析）、全員のタグを数える要件、トラックのボーナス（酸素 8 % での温度上昇など）、M€ の汎用性。欠けているエッジは「関係なし」を意味しない。

### 偽陽性ゼロの検証（Gate B のゲート）

基本・企業時代の全プロジェクトカード（208 枚）を手札に持つ 3 局面（序盤・中盤・終盤、Earth Catapult を場に置く）でグラフを作り、エッジを実エンジンで 1 本ずつ確認した。

| 局面 | エッジ | エンジン確認 | 内訳 |
|---|---|---|---|
| 序盤 | 2,811 | 2,638 | UNLOCKS 587、DISCOUNTS 598、適用済み割引 195、鋼鉄/チタン支払 1,225、SCORING 33 |
| 中盤 | 2,500 | 2,327 | UNLOCKS 300、DISCOUNTS 583、CONFLICTS 19、適用済み割引 190、支払 1,202、SCORING 33 |
| 終盤 | 2,610 | 2,437 | UNLOCKS 386、DISCOUNTS 598、適用済み割引 195、支払 1,225、SCORING 33 |

確認方法: UNLOCKS/CONFLICTS は A をエンジンでプレイした前後で B の要件（エンジンのコンパイル済み要件）の充足・スコアを比較、DISCOUNTS はプレイ後の `getCardCost`、適用済み割引は Earth Catapult なしの局面とのコスト差、支払はエンジンの支払可否規則、SCORING は B の VP を A ありなしでエンジン採点。全件一致、確認不能 0。
エンジン確認していない残り（各局面 173 本）: アクション消費への資源供給と、アクション同士の資源競合（いずれもアクション Golden で検証済みの原子だけから作る）、現在コスト 0 の適用済み割引（金額を主張しない）。

検証で見つけた偽陽性: 現在コストが 1 M€ のカード（Fueled Generators など）に適用済み割引 2 M€ と表示していた → 下限 0 に吸収されるため、コスト 0 のときは金額を出さないよう修正。
ミューテーション: 「イベントもタグを残す」は 3 件失敗で検出。「温度の 2 ℃ 刻みを無視」は偽陰性しか生まないため全件確認では検出できず、境界のテスト（-14 ℃ と最大 -12 ℃、1 段/2 段のカード）を追加して検出。トラック残り段数の上限は、要件の不足段数が残り段数を超えないため現行のエッジでは主張値に影響しない（防御的な上限として残す）。

## 8. Gate C: プラン候補（`analysis/candidates.ts`、`analysis/payments.ts`）

**対象**: 未プレイのプロジェクトカード（手札 → ドラフト済み → 提示中）。企業・プレリュードの選択は計画しない（`discarded` に理由）。最大要件をすでに超えたカードは二度とプレイできないので除外（`discarded`）。

**列挙**:
- 1 枚: 場のカードからの関係（適用済み割引・鋼鉄など）があるもの
- 2〜3 枚: 前のカードから次のカードへ役立つ関係（UNLOCKS / DISCOUNTS / PRODUCES_FOR / SCORING）があり、CONFLICTS_WITH の順序（`playFirst`）に反しないもの

**上限**（P2-22）: 候補カード 40 枚（手札優先）、チェーン 5,000、150 ms、返すプラン 9。上限で止まったら `search.truncated` と警告。時間の上限は負荷時の安全弁で、通常はチェーン数で止まるため同じ局面なら同じ結果（試験済み、`elapsedMs` を除く）。

**各カードの可否**:
| availability | 意味 |
|---|---|
| `legal-now` | プランの 1 枚目で、ゲームが今「プレイ可能」として提示している（`choices` の `projectCard`）。合法性の正本はゲーム |
| `conditional` | 前のカードの後、購入後（提示カード、研究時の価格 `me.cardCost`）、資源・要件がそろった後 |
| `unknown` | 要件やプレイ条件が評価できない |

**ブロッカー**: カードごとの未充足要件（前のカードの UNLOCKS で埋まる分を差し引く）と、1 枚目の支払い可否（`cost`）。
**支払い可否**（P2-08）: M€ + 建物カードなら鋼鉄×価値 + 宇宙カードならチタン×価値 + Helion なら熱。他の支払い手段を与えるカード（Martian Lumber Corp・Psychrophiles など）や支払後の留保（reserveUnits）、対象外拡張があれば `conditional`。M€ だけで判定しない。
**費用**: プラン内の順に、前のカードの割引を引いたコスト（下限 0）。前のカードの割引がカード固有コード（例: Indentured Workers の「次のカード -8」）なら `unknown`。提示カードの購入費は `payments.purchase` に別計上（プレイ費用と混同しない）。

**目的**（`goal`/`goals`）: 関係から unlock（UNLOCKS）・engine（DISCOUNTS/PRODUCES_FOR）・scoring（SCORING）、効果原子から economy（生産増）・terraforming（global/TR）・scoring（VP）・engine（アクション）。
**並べ方**: 目的ごとに「今プレイ可能 → ブロッカーが少ない → 関係が多い → 枚数が少ない → 名前」で並べ、目的を順に 1 つずつ取り出して混ぜる（単一の勝率スコアは使わない）。
**問い**（`question`）: プレイヤーに判断を促す問いを目的ごとに生成（`key`・`params` で翻訳可能、`text` は英語）。推奨はしない。

### 検証（Gate C のゲート「今可能と将来条件付きを区別」）

| 試験 | 内容 | 結果 |
|---|---|---|
| legal-now の正しさ | 3 局面 × 25 枚ずつの手札（全 208 枚を網羅）の行動フェーズで、`legal-now` のカードはすべてエンジンの `canPlay` が真、1 枚目の手札で `legal-now` でないカードはすべて偽、`legal-now` に未充足ブロッカーなし | 全件一致 |
| 支払い可否（P2-08） | 全プロジェクトカード × 5 つの所持資源 × Helion あり/なしで、`met`/`unmet` をエンジンの `canAfford` と比較（1,500 件以上） | 全件一致 |
| プラン内の費用 | 割引を含むプランをエンジンで順にプレイし、各カードの `getCardCost` と予測を比較。`unknown` はカード固有コードの割引の後だけであることも確認 | 全件一致 |
| ミューテーション | 「1 枚目を常に legal-now」「鋼鉄を無視」「プラン内割引を無視」 | 3 件とも検出 |

Gate D で見つけた Gate C の不足: 生産を下げるカード（Strip Mine の電力生産 -2 など）は、その時点で生産が足りないとプレイできない（本体 `Production.canAdjust`、M€ 生産は -5 まで）。プラン内の前のカードの生産変化を含めて判定し、`production` ブロッカーを出すよう修正（回帰試験を追加）。

## 9. Gate D: 生産フェーズ 0〜3 回の予測（`analysis/forecast.ts`）

`buildCandidates(state, limits, graph, horizon)` で各プランに `forecast`（`PlanForecast`）を付ける。horizon は**生産フェーズの回数**（0〜3、範囲外は例外）。

**シミュレーション**（数値のみ、本体の規則を再現）:
1. 購入費・プレイ費用を M€ で支払う（鋼鉄・チタンで代替できる旨は前提に記載）
2. プラン順に、プレイ時の効果原子（資源・生産・TR・温度/酸素）を適用。温度/酸素は本体 `Game.increaseTemperature`/`increaseOxygenLevel` と同じ: 段数は上限で打ち切り、1 段ごとに TR+1、-24 ℃・-20 ℃ 通過で熱生産+1、酸素 8 % 到達で温度+1 段。0 ℃ 到達の海洋はタイル配置なので未解析として記録
3. 生産フェーズ（本体 `Player.runProductionPhase`）: 電力→熱、M€ += M€ 生産 + TR、他の資源 += 生産
4. 同じことを「プランなし」でも行い、差分を返す（`deltas`: プレイ直後と各生産フェーズ後の資源・生産・TR）

**残りの生産回数**: ソロは `lastSoloGeneration - generation + 1`（生産フェーズ前の局面。最終世代も生産あり）、生産後の局面は +0、終局は 0。対人は `unknown`（火星が完成すると終わる）で、前提に「早く終わる可能性」を記載。horizon は残り回数で打ち切る（P2-23）。

**M€ 回収**: `balance`＝horizon 終了時の M€ の差（費用込み）、`returned`＝balance＋支払額、`recovered`＝balance≥0。例（P2-10）: 費用 10・M€ 生産+2 で 3 回の生産後も -4、未回収。
**VP**: TR の増分 ＋ 印刷 VP ＋ タグあたり VP（プランのタグ込み）＋ 場のタグ VP カードの増分 ＋ プレイ時に置く資源の VP。VP が未解析のカードを含むと `unknown`。
**完全性**: 未解析の効果（カードの未解析・ドローの中身・場のカードの反応フック・対象外拡張・費用不明・生産不足でプレイ不可・0 ℃ の海洋）が 1 つでもあれば `complete: false`。その場合 `megacredits` は `unknown`（一部しか分からないプランに総収支を付けない）。`deltas` は分かっている部分だけ。
アクションは任意のため数えない（前提に記載）。

### 検証（Gate D のゲート「本体 Golden との差分一致」）

| 試験 | 結果 |
|---|---|
| 完全な予測すべてを実エンジンで再現（3 局面 × 25 枚ずつの手札、プランをエンジンでプレイし、プランなしのゲームと並べて `runProductionPhase` を 3 回まで実行） | **298 件**、各段階の資源・生産・TR と VP が全件一致 |
| P2-09（Algae）、P2-10（費用 10・M€ 生産+2）、トラックのボーナス、P2-23（ソロ終盤で打ち切り） | 一致 |
| 未解析を含む予測が総収支を出さないこと | 確認 |
| ミューテーション: 熱生産ボーナス無視・生産時の電力→熱なし・酸素 8 % の温度上昇無視 | 3 件とも検出 |

### 性能（Gate D で修正）

全体試験の負荷下で「上限で止まる」試験が 1.2 秒かかり失敗した。原因は、探索の時間上限（150 ms）がチェーン列挙にしか効かず、グラフを**全未プレイカード**（208 枚、約 4.3 万組）で作っていたこと。グラフを場のカード＋探索対象の 40 枚だけで作り、計測をグラフ作成前から始め、プランの評価にも時間上限を適用（打ち切り時は警告）。打ち切りの報告が消えないよう、未プレイカードの総数はスナップショットから数える。

予測込み（horizon 3）の `buildCandidates` 実測（g10、20 回）: 手札 12 枚 p95 2.5 ms、40 枚 p95 38.3 ms、208 枚 p95 67.6 ms（修正前は 1 秒超）。

## 10. Gate E: 分析 API（`analysis/engine.ts`、`routes.ts`）

**データ契約 `coach-analysis/1`**（`CoachAnalysisV1`、計画 §4 に準拠）:
| 項目 | 内容 |
|---|---|
| `source` | 分析した状態の `fingerprint`・`advisoryFingerprint`、`catalogVersion`、`analysisVersion`（コードの版、`2.0.0`）、`generatedAt` |
| `horizonProductionPhases` | 0〜3 |
| `coverage` | グラフに入ったカード（場・手札・提示）の supported / partial / unsupported の数と、未解析の種類別の枚数 |
| `candidates` | Gate C のプラン＋Gate D の予測 |
| `discarded`・`warnings`・`search` | 除外したカード、警告（状態の品質警告を含む）、探索の上限情報 |
| `limitations` | 作らない関係（FEEDS_RESOURCE・AMPLIFIES）と検出しない場合 |

**API**: `GET /api/coach/analysis?id=<playerId>[&horizon=0..3]`（既定 3）。
- 認可は `api/player` と同じ（本人の秘密 ID ＋ Discord 紐付け時は本人）。観戦者 ID・不正形式は 400、不明 ID は 404、Discord 不一致は 403。horizon が 0〜3 以外なら 400。
- `Cache-Control: no-store`。最新の CoachState とカタログから純粋関数で計算し、ゲームを変更しない。
- 失敗はコーチ側で 500（内部の詳細は返さない）。ゲームは継続。計算時間は Gate C の上限（150 ms）で抑え、上限で打ち切った場合は `warnings`・`search.truncated`。
- **キャッシュ**: プロセス内 LRU（64 件）。キーは `fingerprint + advisoryFingerprint + catalogVersion + analysisVersion + horizon + 閲覧者`。閲覧者はプレイヤー ID の SHA-256 先頭 16 桁（キーに ID を残さない）。閲覧者を含むため、他のプレイヤーの手札を含む結果を別の人に返すことはない。応答は複製を返し、キャッシュ内の結果は変更されない。

**履歴との関係**: 分析は現在の局面だけを使い、判断履歴（Phase 1.5）は使わない。履歴が不健全でも現在の局面の分析は有効（計画 §2）。

### 検証

| 試験 | 方法 | 結果 |
|---|---|---|
| 契約・認可・horizon | API 試験（`engine.spec.ts`） | PASS |
| P2-21 同じ局面への連続呼び出し | 同じ本文、2 回目はキャッシュ（計算回数不変）、`game.serialize()` 不変 | PASS |
| キャッシュの分離 | 2 人のプレイヤーで互いの手札が出ない、キーが閲覧者で異なりキーに ID なし | PASS |
| P2-20 相手の公開操作 | 相手が都市を置くと分析の `source.fingerprint` が更新 | PASS |
| P2-16 Undo 後の同一局面 | 復元した同じ局面は同じプラン（履歴上の位置は Phase 1.5 の `seq`/`branch` で別管理） | PASS |
| 失敗の隔離 | 分析が例外 → 500、ゲームは行動待ちのまま | PASS |
| 実機（g10、HTTP） | `liveCheck.ts --analysis`: 毎手、分析が現在の状態のものか、`legal-now` がゲームの提示に含まれるか、ID・相手の手札が出ないかを照合 | ソロ 79 手・1,525 チェック、2 人 229 手・6,606 チェック、利用者のゲーム 2 つ（読み取り専用）232 チェック、**失敗 0** |
| 性能（g10、HTTP） | 同上で計測 | 分析 p95: ソロ 7.6 ms（80 回）、2 人 5.8 ms（300 回）、利用者のゲーム 8.2 / 7.0 ms。状態取得 p95 6.7 ms 以下。目標（分析 500 ms・状態 200 ms）を満たす |

計測条件: g10（GMKtec G10、Node v24.13.0、`npm start`）、同一ホストからの HTTP、各手で状態が変わるため大半はキャッシュ外の計算。手札 208 枚の極端な場合の計算時間は in-process で p95 67.6 ms（§9）。

## 11. 次の段階（未着手）

Gate F タブレット最小 UI（`ClientExtension`、UI 文言の 16 言語翻訳）。
