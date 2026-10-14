# Phase 2 設計（実装済み部分）— 最初の PR: G0 + Gate A + Golden

計画: `TM-COACH-P2`（2026-10-14）。ブランチ `coach/phase2`、起点 `7ee0c64bb`（`main`、内容は `ef8bc6664` と同一）。
計画 §14 に従い、最初の PR は **G0 修正・効果原子（EffectAtom）と未解析の表現・要件分析・実エンジンとの Golden** に絞った。
Gate B（コンボグラフ）以降は未着手。

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

## 6. 次の段階（未着手）

Gate B 有向グラフ（UNLOCKS/DISCOUNTS/PRODUCES_FOR/…）、Gate C プラン列挙、Gate D 2〜3 生産フェーズ予測、Gate E `GET /api/coach/analysis`、Gate F タブレット UI。データ契約 `CoachAnalysisV1` 全体は Gate E で確定する（本 PR では `Evidence`・`Support`・`RequirementGap` のみ）。
