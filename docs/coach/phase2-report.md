# Phase 2 報告 — G0〜Gate F（PR #2〜#6、Gate F）

- 計画: `TM-COACH-P2`、§14「最初の PR」
- ブランチ: `coach/phase2`（起点 `7ee0c64bb` = `main`、内容は `ef8bc6664` と同一）
- 状態: **G0〜Gate E（PR #2〜#6）はマージ済み、Gate F（ブランチ `coach/phase2-gate-f`、起点 `969e918df`）が完了。Phase 2 の全ゲートが完了**（DoD の判定は §11）

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

## 9. Gate E（PR #6、マージ済み）

| 項目 | 結果 |
|---|---|
| データ契約 | `CoachAnalysisV1`（`coach-analysis/1`）: source（指紋・カタログ版・分析版）、coverage、candidates（予測付き）、discarded、limitations、warnings、search |
| API | `GET /api/coach/analysis?id=&horizon=0..3`。本人のみ、no-store、失敗は 500 でゲームは継続 |
| キャッシュ | 指紋・advisory・カタログ版・分析版・horizon・閲覧者（ID のハッシュ）をキーにしたプロセス内 LRU |
| 実機（g10） | ソロ・2 人・利用者のゲーム（読み取り専用）で毎手照合、計 8,463 チェック失敗 0 |
| 性能（DoD 8） | 分析 API p95 5.8〜8.2 ms（目標 500 ms）、状態 API p95 4.8〜6.7 ms（目標 200 ms を維持）。計測条件は設計 §10 |

試験（g10）: コーチ 157 passing（新規 9）。`npm run test:server` 7,874 passing / 1 failing（既存の AI 対局タイムアウト）。`npm run test:client`・`lint:css` は起点と同じ、eslint・i18n・vue-tsc・ビルド成功、テスト型検査は既存 3 件のみ。

次: Gate F（タブレット最小 UI、16 言語の翻訳、P2-24）。

## 10. Gate F（ブランチ `coach/phase2-gate-f`、起点 `969e918df`）

| 項目 | 結果 |
|---|---|
| UI | メニュー「Strategy coach」→ パネル（`CoachPanel.vue`）。プランごとに目的・カードの可否・関係・ブロッカー・生産フェーズごとの表・費用/回収/VP・問い、カバレッジと未解析の注記。局面の変化で自動更新、観戦者には要求しない |
| 文言 | サーバーの英語の自由文は表示せず、構造化項目から固定テンプレートを選んで翻訳。新規 39 件を 16 言語で追加（`src/extensions/coach/locales/`）、`lint:i18n` 全言語 100 % |
| 実機（P2-24） | 縦 768×1024・横 1024×768 で、コーチを開いたままゲームを操作でき（売却・アクションシート・ナビ）、自動更新を確認。日本語でプラン 9 件を表示。テスト用ソロ 51 手で 994 チェック失敗 0 |
| 性能 | 分析 API p95: 同一ホスト 6.0 ms、LAN 上の Mac から 18.2 ms |
| 計画からの変更 | 「縦は下部・横はサイドのドロワー」はアクションシート・下部ナビ・「世代終了」「Undo」を覆ったため、上部バー直下（縦は全幅、横は右上）に変更（[設計 §11](phase2-design.md)） |

変更ファイル:
- 新規: `src/extensions/coach/extension.client.ts`、`src/extensions/coach/client/`（`CoachPanel.vue`・`CoachIcon.vue`・`coachPanelState.ts`・`coachText.ts`）、`src/extensions/coach/locales/<16 言語>/coach.json`、`tests/client/extensions/coach/CoachPanel.spec.ts`、`docs/coach/evidence/p2f-*`
- ゲーム本体: 変更なし（`npm run make:extensions` で生成される登録ファイルに coach のクライアント側が入る）

試験（g10）:

| 試験 | 結果 |
|---|---|
| UI テスト（Vitest） | 12 passed。ミューテーション 3 件を検出 |
| `npm run test:server` | 7,875 passing / 0 failing |
| `npm run test:client` | 1,237 passed / Errors 1（既存の Vitest teardown、`App.spec`） |
| eslint・`lint:i18n`・vue-tsc・`npm run build` | 成功 |
| `lint:css` | 既存 6 件のみ（コーチの `.vue` は指摘なし） |
| テスト型検査（`build:test`） | 既存 3 件のみ |

## 11. Phase 2 の Definition of Done（計画 §12）の判定

| DoD | 判定 | 根拠 |
|---|---|---|
| 1. G0 の 2 修正と単体テスト | 達成 | P2-17・P2-18 PASS（PR #2） |
| 2. 基本カードの分類、未対応を隠さない | 達成 | 基本 148 枚・企業時代 73 枚を理由付きで分類（[カバレッジ](phase2-coverage.md)）。UI にもカバレッジと未解析の注記を表示 |
| 3. 厳密対応効果のエンジン差分一致 100 % | 達成 | 効果・割引・要件・グラフのエッジ（7,402 本）・予測（298 件）がすべてエンジンと一致 |
| 4. 合法性と将来の区別、秘匿情報の漏えい 0 | 達成 | `legal-now` ⇔ `canPlay`・提示との一致、相手の手札・ID が出ないことを試験と実機（Gate E・F で計 9,457 チェック、失敗 0）で確認。UI はプレイヤー本人の ID だけで要求 |
| 5. 異なる目的の候補を複数比較 | 達成（条件付き） | 目的ごとに順に並べる（`offers plans of several goals side by side`）。UI は最大 9 件を目的・費用・予測付きで並べる。優劣の点数は付けない。実機の局面によっては 1 つの目的しか出ない |
| 6. 2〜3 生産フェーズの資源・VP・未回収費用を条件付きで | 達成 | 予測表と回収の判定。未解析を含む場合は合計を出さず、その旨を表示 |
| 7. 既存テストに新規回帰なし、ゲーム変更 0 | 達成 | test:server 0 failing、test:client は既存の 1 件のみ。分析・UI はゲームを変更しない（P2-21） |
| 8. 分析 API p95 500 ms 以下、状態 API p95 200 ms 以下 | 達成 | 分析 p95 5.8〜8.2 ms（同一ホスト）、18.2 ms（LAN）。状態 p95 4.8〜6.7 ms |
| 9. タブレットから候補と根拠を確認、操作を妨げない | 達成（実機タブレットは未確認） | ブラウザの表示サイズ指定で縦・横を確認（P2-24）。実機タブレットでの確認を利用者に依頼する |
| 10. `phase2-*.md` に SHA・試験結果・未対応を記録 | 達成 | 本書、[設計](phase2-design.md)、[QA](phase2-qa.md)、[未対応](phase2-gaps.md)、[カバレッジ](phase2-coverage.md) |

残る確認事項:
- 実機タブレット（Wi-Fi、タッチ）での表示と操作。
- 日本語以外 15 言語の翻訳の母語話者による確認。

次: Phase 3（対話型コーチ）。
