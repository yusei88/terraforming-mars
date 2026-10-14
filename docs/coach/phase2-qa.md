# Phase 2 QA（最初の PR 時点）

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
| 08 | 鉄/チタン/特殊支払 | 一部 | 支払手段は `conditional-cost` として未解析に計上。合法性の判定は未実装（Gate C） |
| 09 | 植物生産+2 と世代推移 | 一部 | Algae のプレイ時効果はエンジン一致。世代推移の予測は Gate D |
| 10 | MC 生産+2、費用 10 の仮想カード | 未実施 | Gate D |
| 11 | Tardigrades の資源と VP | 一部 | `victoryPointsPerResource`（1/4）とアクション（+1 資源）をエンジン一致で確認。VP 計算は Gate D |
| 12 | Media Group の bespoke hook | PASS | `never turns card code or formulas into numbers`（`unsupported`、M€ 原子なし） |
| 13 | 既プレイの割引カード | 一部 | 割引予測はエンジンが計算した現在コストから差し引くため二重計上なし。プラン側は Gate C |
| 14 | 提示カードと手札の区別 | 未実施 | Gate C |
| 15 | 非公開手札・未知山札 | 未実施 | 分析は CoachState のみを入力（Phase 1 の非公開保証を継承）。プラン側の試験は Gate C |
| 16 | Undo 後の同一局面 | 未実施 | Gate E |
| 17 | 履歴 read 失敗 | PASS | `treats an unreadable history as uncertain and writes nothing` |
| 18 | advisory 指紋の不一致 | PASS | `does not fall back when the advisory fingerprint does not match` |
| 19 | Countable/bespoke 未対応 | PASS | Countable を含む全カードが `partial`/`unsupported`、未知キーは `unknown-key` |
| 20 | 対人で公開盤面更新 | 未実施 | Gate E |
| 21 | 同一局面への連続 API 呼出し | 未実施 | Gate E |
| 22 | 手札・候補多数 | 未実施 | Gate C |
| 23 | 終局目前 | 未実施 | Gate D |
| 24 | タブレット横/縦表示 | 未実施 | Gate F |

## 2. 自動試験

| 試験 | 結果 |
|---|---|
| coach テスト（既存 + G0） | 88 件 |
| 分析テスト（新規） | 28 件（extractFeatures 6、requirements 5、golden 17） |
| 合計 | **116 passing / 0 failing**（コーチ全体） |
| ミューテーション | 3 件とも検出 |
| 全体回帰 | [報告](phase2-report.md) に記載 |
