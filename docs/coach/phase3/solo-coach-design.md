# ソロ専用・伴走型コーチの設計（TM-COACH-P3-SOLO）

- 起点: `main` = `88b4f1f8d`（PR #10、選択主導型 P3-CD-1 をマージ後）。2026-10-18。
- 目的: ソロゲームの対局中に、プレイヤーの判断（購入、プレイ、プレイ順、パス、世代の進行）を観察する。改善できた可能性のある判断を**検証可能な根拠で検知**し、プレイを妨げない小さな問いかけで、プレイヤー自身の戦略的な判断力を育てる。
- 方針: 正しい戦略分析を先に成立させ、そこから教育的な問いを作る。最善手を選ぶ AI にはしない。

## 1. 既存の仕組みと不足

| 必要なもの | 既存（Phase 1〜3） | 不足と、このフェーズでの対応 |
|---|---|---|
| 判断の記録（入力、前後の局面、順序） | `CoachTracer`（`coach-trace/1`）。受理された入力ごとに `decision` イベント。提示された選択肢（正規化済み）、`InputResponse`、前後の局面の参照を持つ。局面の本体は `states.jsonl` | 意味がない（「`or` の 2 番目、`projectCard`」としか分からない）。→ **P3-SOLO-1** で、提示された選択肢と応答から、購入・プレイ・標準プロジェクト・パスなどに正規化する |
| Undo と分岐 | `revert` イベント、`branch`。`annotateSeries` で `current`/`superseded`/`unverified` を判定。整合性の検査（`integrity`） | そのまま使う。タイムラインと評価は `current` だけを対象にし、`superseded` は区別して残す |
| 永続化と再起動 | `COACH_TRACE_DIR` があれば JSONL に保存し、再起動後も続きから書く。未設定ならトレーサーは無効（ファイルに触れない） | 未設定のとき、タイムラインは成功扱いにせず **`status: 'disabled'`** を返し、画面にも理由を出す |
| 局面の写像 | `CoachStateV1`（自分の手札、場、資源、生産、提示中の選択肢、`lastSoloGeneration`、`options.soloTR`） | ソロの勝利条件を、ゲームの設定から明示する（`terraform` / `tr63`）。非ソロではこのフェーズの機能を無効にする |
| カードとルールの事実 | カタログ（`coach-catalog/1`）、効果原子（`CardMechanics`）、要件分析（`analyzeRequirements`）、割引（`costAfterDiscount`）、予測（`forecastPlan`、`productionsLeft`）。いずれも本体エンジンとの Golden で検証済み | 判断時点のスナップショットに対してそのまま使う（**判断時点の情報だけ**で評価） |
| 反実仮想 | なし。`Game.serialize()` は `deferredActions` を空で書き出すため、途中の局面は正確に複製できない | **P3-SOLO-2** は、エンジンを動かさない限定的なケースから始める（記録された局面 ＋ 検証済みの分析関数）。証明できないものは断定しない |
| 根拠と検証 | P3-CD-1 の事実カード（`F1`…）、根拠の検証（引用した事実の値、A/B の対応） | 判断ごとの根拠（`EvidenceBuilder`）として同じ形で持つ。P3-SOLO-3 の問いかけでもそのまま使う |
| UI | Gate F の配置（上部バーの直下）、選択主導のパネル | パネルに「タイムライン」の表示を足す（P3-SOLO-1）。カットインは P3-SOLO-3 |
| 外部 AI | `CoachLLMProvider`、同意、上限、フォールバック | P3-SOLO-1/2 では使わない（評価はすべて決定的）。問いの生成は P3-SOLO-3 で、評価の結論を渡さない設計にする |

## 2. 構成

```
CoachTracer (coach-trace/1) ──▶ DecisionEventNormalizer ──▶ CoachTimelineV1 ──▶ GET api/coach/timeline ─▶ タイムライン表示
   decision / revert / integrity      (server/solo/timeline.ts)        │
   + states.jsonl（判断前後の局面）                                      ▼
                                       SoloStrategyEvaluator (server/solo/evaluator.ts)
                                         ├ CounterfactualEvaluator: プレイ順による割引損失
                                         ├ 購入後のプレイ困難
                                         └ 生産投資の回収不足
                                       EvidenceBuilder（根拠 F1…） → CoachFindingV1
                                       InterventionCandidate（信頼度、重要度、重複の除去）
                                                     ▼
                                       GET api/coach/findings ──▶（P3-SOLO-3）カットイン、段階的な問い
```

- すべて読み取り専用。ゲーム本体と `CoachTracer` の書き込み経路は変更しない。
- **判断時点の情報**: 評価は、その判断の `before` スナップショット（プレイヤーに見えていた局面）と、それ以前の現行系列のイベントだけを使う。後で引いたカードや未来の山札は使わない。
- **Undo**: `series: 'current'` のイベントだけを評価する。`superseded` はタイムラインで区別して見せるが、評価しない。`unverified`（整合性が不確か）は評価しない。
- **重複の防止**: イベントは `seq`（トレース内で一意）で正規化する。同じ `seq` が二度読めても 1 件にする。評価の結果は、種類と根拠のイベントから作る安定した ID（`findingId`）を持ち、P3-SOLO-3 の通知の重複除去に使う。

## 3. 型（P3-SOLO-1/2）

正本は `src/extensions/coach/common/CoachTimeline.ts` と `CoachFindings.ts`。

```ts
// P3-SOLO-1
type SoloRules = {victory: 'terraform' | 'tr63', lastGeneration: number};
type TimelineKind = 'buy-cards' | 'initial-selection' | 'play-card' | 'standard-project' | 'card-action' |
  'sell-patents' | 'pass' | 'end-turn' | 'game-option' | 'follow-up' | 'other' | 'undo' | 'cancel-action';
type TimelineEvent = {
  id: string;                 // `s<seq>`（トレースの seq から。安定）
  seq: number; kind: TimelineKind;
  generation: number; phase: string; branch: number;
  series: 'current' | 'superseded' | 'unverified';
  cards: string[];            // 購入した、プレイした、売ったカード（購入 0 枚もあり得る）
  offeredCards?: string[];    // 購入: 提示されていたカード
  cost?: number;              // プレイ: 判断時点でゲームが計算した費用
  payment?: Partial<Record<string, number>>;   // プレイ: 実際の支払い
  label?: string;             // ゲームの選択肢の題名（英語、クライアントで翻訳）
  before?: ResourceSnapshot; after?: ResourceSnapshot;   // M€、資源、生産、TR
  verified: boolean;          // 前後の局面で意味を確認できた（手札→場、手札に追加 など）
  order?: number;             // 現行系列の、その世代の中での行動の順番（1, 2, …）
};
type CoachTimelineV1 = {
  schemaVersion: 'coach-timeline/1';
  status: 'ok' | 'disabled' | 'unreadable' | 'not-solo';
  history: 'valid' | 'rollback-detected' | 'uncertain' | 'disabled';
  solo?: SoloRules;
  generations: Array<{generation: number, events: TimelineEvent[]}>;  // current と unverified（古い順）
  superseded: TimelineEvent[];                                        // Undo などで取り消された行動
  now: {generation: number, phase: string, terraformRating: number, victoryPoints?: number};  // 現在の得点（予測ではない）
};

// P3-SOLO-2
type FindingKind = 'play-order-discount' | 'unplayable-purchase' | 'production-payback';
type CoachFindingV1 = {
  id: string;                 // 種類と根拠のイベントから作る安定 ID
  kind: FindingKind;
  decision: {eventId: string, seq: number, generation: number};  // 評価する判断
  related: string[];          // 関係するイベント（例: 後でプレイしたカード）
  actual: {summary: Label, megacredits?: number};
  alternative: {summary: Label, megacredits?: number};
  difference?: {megacredits: number};      // 根拠から計算した差（この観点だけ）
  evidence: CoachFact[];      // 根拠（局面のスナップショット、カタログ、分析）。F1…
  confidence: 'verified' | 'conditional' | 'unknown';
  unmodeled: string[];        // 評価できない効果
  limits: string[];           // この評価が見ていない観点（理由コード）
  intervention: boolean;      // P3-SOLO-3 の問いかけの候補にできるか（verified かつ重要度が基準以上）
  severity: 'minor' | 'notable';
};
type CoachFindingsV1 = {
  schemaVersion: 'coach-findings/1';
  status: 'ok' | 'disabled' | 'unreadable' | 'not-solo';
  solo?: SoloRules;
  findings: CoachFindingV1[];
  checked: Array<{kind: FindingKind, decisions: number, skipped: Array<{reason: string, count: number}>}>;
};
```

## 4. P3-SOLO-1 — 意思決定の履歴とタイムライン

**正規化**（`DecisionEventNormalizer`）: `decision` イベントの `offered`（正規化済みの選択肢の木）を、`response` に沿ってたどる。

| たどり着いた入力 | 種類 | 確認（`verified`） |
|---|---|---|
| `projectCard`（題名が Standard projects 以外） | `play-card`。費用は判断時点の `calculatedCost`、支払いは応答から | `after` で、カードが手札から消えて場にある |
| `projectCard`（Standard projects） | `standard-project` | — |
| `card` ＋ `selectBlueCardAction` | `card-action` | — |
| `card`（題名に buy） | `buy-cards`（0 枚もあり得る）。提示されていたカードも残す | `after` の手札に、選んだカードが加わっている |
| `card`（Sell patents） | `sell-patents` | 手札から消えている |
| `initialCards` | `initial-selection`（企業、初期購入） | 初期購入のカードが手札にある |
| `option` | `pass`、`end-turn`、それ以外は `game-option`（題名を保持） | — |
| その他（`space`、`payment` など、行動の途中の入力） | `follow-up` | — |

- `revert` イベントは、`undo` / `cancel-action` として系列の境目に置く。
- **複合入力**: 研究フェーズで 3 枚を買った場合は 1 件の `buy-cards`（`cards` が 3 枚）にする。カードごとのプレイとは混同しない。
- **世代**: `before.version.generation`。順番（`order`）は、現行系列の行動（`follow-up` を除く）に世代ごとに振る。

**API**: `GET api/coach/timeline?id=<playerId>` → `CoachTimelineV1`。
- 本人の認可、`no-store`、読み取り専用。
- 非ソロは `not-solo`。トレースが無効なら `disabled`。
- 局面のスナップショットは、要求ごとに `states.jsonl` を 1 回だけ読む（`readEvents` と同様）。

**画面**: パネル上部に「選択肢 / タイムライン」の切り替え。
- 世代ごとに、購入（カード名と枚数）、プレイ（実行順の番号、費用）、標準プロジェクト、パスを表示する。
- Undo で取り消された行動は、件数と折りたたみで区別する。
- 配置は Gate F と同じ。

## 5. P3-SOLO-2 — 戦略評価と反実仮想

評価はすべて決定的（LLM なし）。判断時点のスナップショットと、検証済みの分析関数だけを使う。

### A. プレイ順による割引損失（`CounterfactualEvaluator`）

条件（すべて満たしたときだけ `verified`）:
1. 同じ世代の現行系列で、カード X をプレイし、その後でカード Y をプレイした。
2. X をプレイした判断の `before` で、Y はゲームの「Play project card」に含まれていた（Y を先に出せた）。
3. Y の割引が X に効く。`costAfterDiscount(before, X, Y)` で、ゲームの計算した費用から割引を引く（下限 0、Golden 検証済み）。
4. Y を先に払ったうえで、割引後の X を払えた。支払いの組み合わせ（M€、建材、チタン、Helion の熱）を、ゲームの規則で確認する。Y の効果で得る資源は数えない（保守的）。
5. Y を先に出すことで、X の条件が崩れない。X に最大の条件がある、または Y が生産を減らし X も生産を減らす場合は `conditional`。
6. X が Y を割り引く場合（実際の順序にも利点がある）も含めて、両方の順序の合計費用を比べる。
   - 実際: X（判断時点の費用）＋ Y（Y の判断時点の費用）
   - 代替: Y（X の判断時点の費用）＋ X（割引後）
   - 差が 0 以下なら候補にしない。

### B. 購入後のプレイ困難

- **`verified`**: 購入時点のスナップショットで、カードの最大の条件がすでに超えていた（`permanentlyUnmet`。グローバルパラメータは下がらないので、二度と満たせない）。購入費が無駄になったことを根拠付きで示せる。
- **`conditional`**（候補にしない）: 最終世代の購入で、購入後の支払い能力と条件から見てプレイが難しい場合。将来のドローや行動に依存するため断定しない。
- 単に未プレイであることは評価しない。後で出したカードは対象外にする。

### C. 生産投資の回収不足

- 対象は、残りの生産フェイズが 3 以下（Phase 2 の予測の範囲で、ゲームの終わりまでを数えられる）のときにプレイした、生産を増やすカード。
- `forecastPlan`（判断時点、範囲 ＝ 残りの生産フェイズ）で、払った費用が回収されるかを見る。
- **`verified`**: 効果がすべて数値化され（`complete`）、VP と TR の増加がなく、生産の増加が M€ だけで、回収できない。
- **`conditional`**（候補にしない）: VP、TR、M€ 以外の生産（ソロでは地球化に効く熱や植物を含む）、コンボ、数値化できない効果がある。付随効果を無視した損益の断定はしない。

### 根拠と表現

- 根拠は事実カード（`F1`…）で持つ。値はスナップショット、カタログ、分析の出力から取り、どのイベントの局面かも記録する。
- 「最適」「正解」「悪手」は使わない。差は「この観点では代替案が有利（M€ がいくら少ない）」と表す。
- **介入候補**（`intervention: true`）にするのは、次の 3 つを満たすものだけ。
  - `verified` である
  - 差が基準以上（M€ 2 以上、または購入の無駄）
  - 未解析の効果が判断に関わらない

## 6. P3-SOLO-3/4 の計画と着手条件

### P3-SOLO-3 — カットインと段階的な問い

**着手条件**
- P3-SOLO-2 がマージされている。
- 実プレイ 1 局で、`intervention: true` の発見が誤検知 0 件（開発者の確認）。

**内容**
- **通知**: 行動の後、`GET api/coach/findings` の差分を見て、未通知の介入候補を 1 件だけ小さく通知する（ID で重複を除き、無視・保留・閉じるを記録する）。
  - 局面のポーリングは増やさない。ゲームの画面更新（`view` の変化）を契機にする。
- **段階的な問い**（`CoachQuestioner`）: 評価役（`Strategist`、決定的な評価）と問いかけ役を分ける。
  - 問いかけ役には、結論（代替案が有利）を渡さず、「判断」「関係するカード」「観点」だけを渡す。
  - Gate A: なぜその順で出したか（選択式）
  - Gate B: 見落とした観点（例: Y の効果は X に関係するか）
  - Gate C: 根拠を見て再評価する（事実カード）
  - 解説: 希望したときだけ、代替案との差と根拠を出す
- **AI の利用**: 問いの文面だけに使う（任意、同意制）。テンプレートで完結させる。行動の前の介入は設定でオンにする。

### P3-SOLO-4 — 世代のレビューと実プレイ評価

**着手条件**: P3-SOLO-3 で、通知と問いが実機で一通り動いている。

**内容**
- 世代の終わりと対局の終わりに、購入・プレイ・パスのまとめ、重要な判断、気づきを表示する。
- 勝利条件に何が効いたかの分析は、ソロの勝利条件に沿って行う。
  - 地球化モードは、グローバルパラメータの進み方。
  - TR63 モードは、TR の推移。
- 介入の頻度と有用性を、匿名の指標として記録する。
- ソロ 1 局の E2E 評価を行う。

## 7. 安全と制約

- 読み取り専用。本人の認可、`no-store`。
- LLM には、ゲーム ID、プレイヤー ID、名前、山札を送らない（P3-SOLO-1/2 は LLM を使わない）。
- トレースのファイルは、要求ごとに 1 回読む。イベントは数百件程度で、計算は線形。上限を超える分は打ち切り、その旨を表示する。
- 非ソロ、トレースの無効、読み込みの失敗は、それぞれ状態として返す。成功に見せかけない。
- 未対応の拡張に関わる効果は、評価に使わない（`unmodeled` に記録する）。
