# Phase 2 QA（G0〜Gate F）

環境: g10（Node v24.13.0）。P2-01〜23 は自動テスト（テスト専用ゲーム）、P2-24 はブラウザでの実機確認（テスト用ソロゲーム、縦 768×1024・横 1024×768）。

## 1. シナリオ（P2-01〜P2-24）

| ID | シナリオ | 状態 | 証跡 |
|---|---|---|---|
| 01 | Earth Catapult → 後続カード | PASS | `golden.spec › predicts every card cost after Earth Catapult exactly` |
| 02 | Space Station → 宇宙/非宇宙タグ | PASS | `… after Space Station exactly`（全カードでエンジン一致） |
| 03 | Earth Office → 地球タグ | PASS | `… after Earth Office exactly`、`Earth Office lowers only cards with Earth tags` |
| 04 | 複数割引と低額カード | PASS | 全割引カードを Earth Catapult 適用済みで照合、`never predicts a cost below 0` |
| 05 | Algae の海洋 4→5 | PASS | `finds the missing ocean of Algae and agrees with the offered choices`（gap 1 → met、choices と一致） |
| 06 | 科学タグとワイルドタグ | PASS | `counts wild tags for minimum tag requirements only`（エンジン一致） |
| 07 | 温度/酸素の最大要件 | PASS | `reads maximum requirements…`（`permanentlyUnmet`）、要件緩和もエンジン一致 |
| 08 | 鉄/チタン/特殊支払 | PASS | `judges affordability like the engine`（鋼鉄・チタン・Helion の熱、全カード × 10 条件でエンジン一致）。他の支払手段は `conditional` |
| 09 | 植物生産+2 と世代推移 | PASS | `follows plant production over the generations (Algae)`（植物 1→3→5→7）、生産フェーズはエンジン Golden で一致 |
| 10 | MC 生産+2、費用 10 の仮想カード | PASS | `does not call an investment paid back too early`（-10, -8, -6, -4、未回収） |
| 11 | Tardigrades の資源と VP | PASS | 資源あたり VP とアクションはエンジン一致。予測では今ある資源の VP のみ数え、アクションは任意として数えない（前提に記載） |
| 12 | Media Group の bespoke hook | PASS | `never turns card code or formulas into numbers`（`unsupported`、M€ 原子なし） |
| 13 | 既プレイの割引カード | PASS | グラフ: `alreadyApplied`（現在コストに含み済み）。プラン: 費用は現在コストから前のカードの割引のみ差し引く（`predicts the cost of each card of a plan`、エンジン一致） |
| 14 | 提示カードと手札の区別 | PASS | グラフ: `offered` ゾーン。プラン: `keeps offered cards as conditional with their purchase cost`（購入費を `purchase` に別計上、`legal-now` にしない） |
| 15 | 非公開手札・未知山札 | PASS | グラフ・プランとも相手の手札名が出ない（`never plans with another player's hidden cards`） |
| 16 | Undo 後の同一局面 | PASS | `analyses the position after an undo…`（同じ局面は同じプラン、履歴上の位置は Phase 1.5 で別管理） |
| 17 | 履歴 read 失敗 | PASS | `treats an unreadable history as uncertain and writes nothing` |
| 18 | advisory 指紋の不一致 | PASS | `does not fall back when the advisory fingerprint does not match` |
| 19 | Countable/bespoke 未対応 | PASS | Countable を含む全カードが `partial`/`unsupported`、未知キーは `unknown-key` |
| 20 | 対人で公開盤面更新 | PASS | `follows public changes made by another player`、実機 2 人対局で毎手照合 |
| 21 | 同一局面への連続 API 呼出し | PASS | `gives the same result for the same position and does not change the game`（キャッシュから同じ本文、ゲーム不変） |
| 22 | 手札・候補多数 | PASS | `stops at its limits with many cards and says so`（208 枚で 40 枚に制限・警告、チェーン上限 10 で停止・警告）。予測込みの実測 p95: 12 枚 2.5 ms、40 枚 38.3 ms、208 枚 67.6 ms |
| 23 | 終局目前 | PASS | `counts the production phases left in a solo game`、`cuts the horizon at the end of a solo game and says so` |
| 24 | タブレット横/縦表示 | PASS | 縦・横ともコーチを開いたままアクションシート・下部ナビ・盤面を操作でき、カード売却後に自動更新。候補（目的・カード・可否）と根拠（関係・ブロッカー・予測表・カバレッジ）を日本語で表示（[設計 §11](phase2-design.md)、`evidence/p2f-*`）。計画の「縦は下部・横はサイド」の配置は操作を妨げたため変更 |

## 2. Gate B のゲート（偽陽性なし）

3 局面 × 208 枚の手札で作ったエッジ 7,921 本のうち 7,402 本を実エンジンで個別に確認し、全件一致・確認不能 0（内訳は [設計 §7](phase2-design.md)）。名前付きの確認: Earth Office→Cartel の割引 3、Arctic Algae と温度カードの順序（-12 ℃ で Asteroid、-14 ℃ で Big Asteroid のみ）、同じタグだけのカード（Power Plant と Geothermal Power）には結線なし、Mine→Power Plant は鋼鉄支払のみ。

## 3. Gate C のゲート（今可能と将来条件付きの区別）

[設計 §8](phase2-design.md) の検証表のとおり、`legal-now` とエンジンの `canPlay`、支払い可否とエンジンの `canAfford`、プラン内の費用とエンジンの `getCardCost` がすべて一致。ミューテーション 3 件を検出。

## 4. Gate D のゲート（本体 Golden との差分一致）

完全な予測 298 件を実エンジンで再現し、プレイ直後と各生産フェーズ後の資源・生産・TR、VP が全件一致（[設計 §9](phase2-design.md)）。この試験で Gate C の不足（生産を下げるカードの合法性）が見つかり修正した。

## 5. Gate E（API・実機）

| 項目 | 結果 |
|---|---|
| API 試験 | 契約・horizon・認可・no-store・キャッシュ分離・失敗の隔離、すべて PASS |
| 実機（g10、`liveCheck.ts --analysis`） | ソロ 1,525、2 人 6,606、利用者のゲーム（読み取り専用）232 チェック、失敗 0 |
| 分析 API の P95（HTTP） | 5.8〜8.2 ms（目標 500 ms 以下） |
| 状態 API の P95（HTTP） | 4.8〜6.7 ms（目標 200 ms 以下を維持） |

証跡: `docs/coach/evidence/p2e-live-*.json`（ID なし）。

## 6. Gate F（タブレット UI・実機）

| 項目 | 結果 |
|---|---|
| 縦 768×1024 | コーチを開いたまま「アクション」→「売却」でカードを売却、コーチが自動更新（M€・手札枚数・カバレッジ） |
| 横 1024×768 | コーチは右上。アクションシート（世代終了・Undo を含む）・ナビ・盤面を操作可能 |
| 日本語 | プラン 9 件の局面で、目的・バッジ・カード名・関係・予測表・注記・問いがすべて日本語 |
| 実機の照合 | テスト用ソロを終局まで 51 手、994 チェック、失敗 0、分析 p95 6.0 ms |
| LAN 経由（Mac → g10） | 分析 API p95 18.2 ms（30 回） |
| 見つけて直した事項 | ①下部ドロワーがアクションシートと下部ナビを覆った ②横のサイドドロワーが「世代終了」「Undo」を覆った ③背景の透過で下の文字が透けた → 上部ドロワーに変更、背景を不透明に |

確認はブラウザの表示サイズ指定で行った。実機タブレット（Wi-Fi）での確認は利用者に依頼する（[未対応](phase2-gaps.md)）。

## 7. 自動試験

| 試験 | 結果 |
|---|---|
| coach テスト（既存 + G0） | 88 件 |
| 分析テスト | 69 件（extractFeatures 6、requirements 5、golden 18、synergyGraph 12、candidates 10、forecast 9、engine/API 9） |
| 合計（サーバー） | **157 passing / 0 failing**（コーチ全体） |
| UI テスト（Vitest） | 12 件（`CoachPanel.spec.ts`: パネル 8、文言 4） |
| ミューテーション | Gate A 3 件、Gate B 2 件、Gate C 3 件、Gate D 3 件、Gate F 3 件を検出 |
| 全体回帰 | [報告](phase2-report.md) に記載 |
