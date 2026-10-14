# Phase 2 進捗報告 — G0〜Gate D（PR #2〜#5）、Gate E

- 計画: `TM-COACH-P2`、§14「最初の PR」
- ブランチ: `coach/phase2`（起点 `7ee0c64bb` = `main`、内容は `ef8bc6664` と同一）
- 状態: **G0〜Gate D（PR #2〜#5）はマージ済み、Gate E（ブランチ `coach/phase2-gate-e`）が完了。Phase 2 全体は進行中**（Gate F 未着手）

関連: [設計](phase2-design.md) / [カバレッジ監査](phase2-coverage.md) / [QA](phase2-qa.md) / [未対応](phase2-gaps.md)

## 1. 実施内容

| ゲート | 内容 | 結果 |
|---|---|---|
| G0 | 履歴の読込失敗を `valid` と扱わない、新形式スナップショットの曖昧フォールバック禁止 | 完了（P2-17・P2-18 PASS） |
| A | `EffectAtom` / `UnmodeledEffect` の型、抽出器、要件分析、割引予測、基本・企業時代の全カード監査 | 完了 |
| Golden | 実エンジンとの差分試験: 割引 10 種 × 全プロジェクトカード、下限 0、supported 全カードのプレイ時効果・アクション・企業、評価可能な全要件 | 全件一致 |

変更ファイル:
- 変更: `src/extensions/coach/server/coachTrace.ts`・`traceStore.ts`・`routes.ts`（G0）、`tests/extensions/coach/history.spec.ts`・`routes.spec.ts`・`traceStore.spec.ts`
- 新規: `src/extensions/coach/common/CoachMechanics.ts`・`CoachAnalysis.ts`、`src/extensions/coach/server/analysis/`（extractFeatures・requirements・discounts・mechanicsCatalog）、`tests/extensions/coach/analysis/`（3 ファイル）、`scripts/coach/coverageReport.ts`、`docs/coach/phase2-*.md`
- ゲーム本体: 変更なし

## 2. 試験結果（g10）

| 試験 | 結果 |
|---|---|
| コーチ全体 | **116 passing / 0 failing**（既存 86 + G0 2 + 分析 28） |
| `npm run test:server` | 7,833 passing / 1 failing（既存の AI 対局タイムアウト。起点でも発生） |
| `npm run test:client` | 1,225 passed / Errors 1（既存の Vitest teardown） |
| eslint / i18n / vue-tsc / build / テスト型検査 | 成功（テスト型検査は既存 3 件のみ） |
| ミューテーション | ワイルドタグ無視・タグ割引の誤適用・`global` 無視の 3 件をすべて検出 |

## 3. 計画 DoD との対応（この PR の範囲）

| DoD | 状態 |
|---|---|
| 1. G0 の 2 修正と単体テスト | 完了 |
| 2. 基本カードの supported/partial/unsupported 分類 | 完了（企業時代も含む。理由付きで [phase2-coverage.md](phase2-coverage.md)） |
| 3. 厳密対応効果のエンジン差分一致 100 % | この PR で厳密とした効果（プレイ時効果・アクション・企業・割引・要件）は 100 %。予測（Gate D）は未着手 |
| 4〜10 | Gate B〜F で対応 |

## 4. 見つけた事項

- ThorGate の割引が一時「予測不能」になった: 標準プロジェクト用のフック（`getStandardProjectDiscount`）まで除外していたため。プロジェクトカードのコストに関わるのは `getCardDiscount` だけなので修正し、全 208 枚でエンジン一致。
- 企業の開始 M€・研究カード価格が効果原子に入っていなかった（自己レビューで発見）。追加し、企業のエンジン試験を追加。
- Golden の対象を「プレイ時効果」だけにしていた（アクション・企業が未検証のまま supported と表示されるところだった）。両方の試験を追加して全件一致。

## 5. 次の手順（PR #2 時点）

PR #2 のレビュー後に Gate B へ進んだ（§6）。計画 §14 のとおり、データの出自とテストオラクルを先に確定させた。

## 6. Gate B（PR #3、マージ済み）

| 項目 | 結果 |
|---|---|
| コンボの有向グラフ（`analysis/synergyGraph.ts`） | UNLOCKS / DISCOUNTS / PRODUCES_FOR / SCORING / CONFLICTS_WITH を生成。FEEDS_RESOURCE / AMPLIFIES は理由付きで生成しない |
| ゲート「Golden に偽陽性なし」 | 3 局面 × 208 枚の手札でエッジ 7,921 本、うち 7,402 本を実エンジンで個別確認し全件一致、確認不能 0 |
| 追加した原子 | `victoryPointsPerTag`（VP の Golden で全件一致） |
| Golden の拡張 | アクション: `partial` カードも含め、アクション部分に未解析がない全カード。VP: VP を原子化した全カード |
| 見つけた不具合 | 適用済み割引の過大表示（コスト 1 M€ のカードに 2 M€）、カード固有コードのアクションを `static` に分類していた → 修正 |

試験（g10）: コーチ 129 passing（新規 13）。`npm run test:server` 7,846 passing / 1 failing（既存の AI 対局タイムアウト）。
`npm run test:client`・`lint:css` は起点と同じ結果、eslint・i18n・vue-tsc・ビルド成功、テスト型検査は既存 3 件のみ。
途中の全体実行で、新しい VP の Golden が並列実行の負荷で既定の 2 秒を超えたため、重いエンジン照合のテストに明示的なタイムアウト（30 秒）を付けた。

次: Gate C（手札・提示カード中心の 3 枚以内のプラン列挙、現在可能／条件付きの区別、探索上限）。

## 7. Gate C（PR #4、マージ済み）

| 項目 | 結果 |
|---|---|
| プラン候補（`analysis/candidates.ts`） | 手札・提示カードから 1〜3 枚の連なり。各カードの可否（`legal-now` / `conditional` / `unknown`）、ブロッカー、プレイ費用と購入費、目的、問い |
| 支払い可否（`analysis/payments.ts`） | M€・鋼鉄・チタン・Helion の熱。他の支払い手段は `conditional` |
| ゲート「今可能と将来条件付きの区別」 | `legal-now` ⇔ エンジンの `canPlay`、支払い可否 ⇔ `canAfford`（1,500 件以上）、プラン内の費用 ⇔ `getCardCost`、すべて一致 |
| 上限 | 40 枚・5,000 チェーン・150 ms・9 プラン。上限で止まると警告 |
| ミューテーション | 3 件とも検出 |

見つけた事項: Indentured Workers（次のカード -8、カード固有コード）の後のカードの費用を、推測せず `unknown` にしていることを試験で確認し、`unknown` の理由が「前のカードの割引がカード固有コード」に限られることを試験に追加した。

試験（g10）: コーチ 138 passing（新規 9）。`npm run test:server` 7,855 passing / 1 failing（既存の AI 対局タイムアウト）。`npm run test:client`・`lint:css` は起点と同じ、eslint・i18n・vue-tsc・ビルド成功、テスト型検査は既存 3 件のみ。

次: Gate D（0〜3 回の生産フェーズの資源・TR・確定 VP の予測）。

## 8. Gate D（PR #5、マージ済み）

| 項目 | 結果 |
|---|---|
| 予測（`analysis/forecast.ts`） | 生産フェーズ 0〜3 回。プランあり/なしを本体の規則（温度・酸素のボーナス、電力→熱、TR 収入）で計算し差分を返す。ソロは残り回数で打ち切り、対人は `unknown` |
| M€ 回収・VP | balance / returned / recovered、TR・印刷 VP・タグ VP。未解析を含むと総収支を出さない |
| ゲート「本体 Golden との差分一致」 | 完全な予測 298 件をエンジンで再現し、プレイ直後・各生産後の資源・生産・TR と VP が全件一致 |
| ミューテーション | 3 件とも検出 |

見つけて直した事項:
- Gate C の不足: 生産を下げるカード（Strip Mine など）は、その時点の生産が足りないとプレイできない（本体 `Production.canAdjust`）。プラン内の前のカードを含めて判定し `production` ブロッカーを出す（予測 Golden で発見、回帰試験を追加）。
- 性能: 全体試験の負荷下で探索が 1.2 秒かかった。グラフを探索対象の 40 枚に限定し、評価にも時間上限を適用。208 枚でも p95 67.6 ms。

試験（g10）: コーチ 148 passing（新規 10）。`npm run test:server` 7,866 passing / 0 failing。`npm run test:client`・`lint:css` は起点と同じ、eslint・i18n・vue-tsc・ビルド成功、テスト型検査は既存 3 件のみ。

次: Gate E（`CoachAnalysisV1` と `GET /api/coach/analysis`、キャッシュ、P95 500 ms の実測）。

## 9. Gate E（ブランチ `coach/phase2-gate-e`、起点 `2b8d5abf7`）

| 項目 | 結果 |
|---|---|
| データ契約 | `CoachAnalysisV1`（`coach-analysis/1`）: source（指紋・カタログ版・分析版）、coverage、candidates（予測付き）、discarded、limitations、warnings、search |
| API | `GET /api/coach/analysis?id=&horizon=0..3`。本人のみ、no-store、失敗は 500 でゲームは継続 |
| キャッシュ | 指紋・advisory・カタログ版・分析版・horizon・閲覧者（ID のハッシュ）をキーにしたプロセス内 LRU |
| 実機（g10） | ソロ・2 人・利用者のゲーム（読み取り専用）で毎手照合、計 8,463 チェック失敗 0 |
| 性能（DoD 8） | 分析 API p95 5.8〜8.2 ms（目標 500 ms）、状態 API p95 4.8〜6.7 ms（目標 200 ms を維持）。計測条件は設計 §10 |

試験（g10）: コーチ 157 passing（新規 9）。`npm run test:server` 7,874 passing / 1 failing（既存の AI 対局タイムアウト）。`npm run test:client`・`lint:css` は起点と同じ、eslint・i18n・vue-tsc・ビルド成功、テスト型検査は既存 3 件のみ。

次: Gate F（タブレット最小 UI、16 言語の翻訳、P2-24）。
