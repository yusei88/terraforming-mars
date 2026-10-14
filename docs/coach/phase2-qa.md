# Phase 2 QA（Gate D まで）

環境: g10（Node v24.13.0）。試験はすべて自動テスト（テスト専用ゲーム）。本 PR では実機 UI 試験の対象機能（API・UI）はまだない。

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
| 16 | Undo 後の同一局面 | 未実施 | Gate E |
| 17 | 履歴 read 失敗 | PASS | `treats an unreadable history as uncertain and writes nothing` |
| 18 | advisory 指紋の不一致 | PASS | `does not fall back when the advisory fingerprint does not match` |
| 19 | Countable/bespoke 未対応 | PASS | Countable を含む全カードが `partial`/`unsupported`、未知キーは `unknown-key` |
| 20 | 対人で公開盤面更新 | 未実施 | Gate E |
| 21 | 同一局面への連続 API 呼出し | 未実施 | Gate E |
| 22 | 手札・候補多数 | PASS | `stops at its limits with many cards and says so`（208 枚で 40 枚に制限・警告、チェーン上限 10 で停止・警告）。予測込みの実測 p95: 12 枚 2.5 ms、40 枚 38.3 ms、208 枚 67.6 ms |
| 23 | 終局目前 | PASS | `counts the production phases left in a solo game`、`cuts the horizon at the end of a solo game and says so` |
| 24 | タブレット横/縦表示 | 未実施 | Gate F |

## 2. Gate B のゲート（偽陽性なし）

3 局面 × 208 枚の手札で作ったエッジ 7,921 本のうち 7,402 本を実エンジンで個別に確認し、全件一致・確認不能 0（内訳は [設計 §7](phase2-design.md)）。名前付きの確認: Earth Office→Cartel の割引 3、Arctic Algae と温度カードの順序（-12 ℃ で Asteroid、-14 ℃ で Big Asteroid のみ）、同じタグだけのカード（Power Plant と Geothermal Power）には結線なし、Mine→Power Plant は鋼鉄支払のみ。

## 3. Gate C のゲート（今可能と将来条件付きの区別）

[設計 §8](phase2-design.md) の検証表のとおり、`legal-now` とエンジンの `canPlay`、支払い可否とエンジンの `canAfford`、プラン内の費用とエンジンの `getCardCost` がすべて一致。ミューテーション 3 件を検出。

## 4. Gate D のゲート（本体 Golden との差分一致）

完全な予測 298 件を実エンジンで再現し、プレイ直後と各生産フェーズ後の資源・生産・TR、VP が全件一致（[設計 §9](phase2-design.md)）。この試験で Gate C の不足（生産を下げるカードの合法性）が見つかり修正した。

## 5. 自動試験

| 試験 | 結果 |
|---|---|
| coach テスト（既存 + G0） | 88 件 |
| 分析テスト | 60 件（extractFeatures 6、requirements 5、golden 18、synergyGraph 12、candidates 10、forecast 9） |
| 合計 | **148 passing / 0 failing**（コーチ全体） |
| ミューテーション | Gate A 3 件、Gate B 2 件、Gate C 3 件、Gate D 3 件を検出 |
| 全体回帰 | [報告](phase2-report.md) に記載 |
