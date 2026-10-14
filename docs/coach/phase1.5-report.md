# Phase 1.5 完了報告

- 計画: `TM-COACH-P1.5`
- ブランチ: `coach/phase1.5`（起点 `c2944817c0560395aa9cedd95e988c59f136e6de`）
- 実装コミット: `6e5f05bbf`（本報告は次のコミット）
- 関連: [設計](phase1.5-design.md) / [QA](phase1.5-qa.md) / [未対応](phase1.5-gaps.md) / [運用手順](operations.md)

## 1. 実施内容

| ゲート | 内容 | 結果 |
|---|---|---|
| G0 | 起点 SHA・作業ツリー確認、`coach/phase1.5` 作成、既存 JSONL を 0600 でバックアップ、Phase 1 テスト再現 | 完了 |
| G1 | P1.5-01 アクセス制御 + P1.5-05 耐障害性（`traceStore.ts`、トレーサの書込順序） | 完了 |
| G2 | P1.5-03 `advisoryFingerprint`（既存 `fingerprint` 不変） | 完了 |
| G3 | P1.5-04 `seq`+`position` による位置参照、Phase 1 記録の legacy 扱い | 完了 |
| G4 | P1.5-02 整合性検査（`integrity.ts`）、`series` 表示 | 完了 |
| G5 | 全回帰、実機（npm・別 UID・再起動・Docker）、文書 | 完了 |

変更ファイル: コーチ拡張内のみ（`src/extensions/coach/` の新規 2・変更 6）、テスト（新規 3・変更 3）、`scripts/coach/verifyTrace.ts`（新規）、文書。**ゲーム本体は無変更**。

## 2. Definition of Done との照合

| 条件 | 結果 |
|---|---|
| H01〜H03 全件 PASS、不適切な参照 0 | PASS。別 UID からの読取拒否を実機確認。他者所有ファイルは UID 判定の差し替えで試験（実 UID は root 必要） |
| H04〜H06 全件 PASS、未成功の書込を成功扱いしない | PASS。実機 11 ゲームで参照先不明イベント 0 |
| H07〜H08 PASS、既存 fingerprint と API 互換 | PASS。Phase 1 の 1,015 スナップショットで既存 fingerprint の再計算が全件一致。`?fingerprint=` も維持 |
| H09〜H11 PASS | PASS |
| H12〜H15 PASS、判定不能は `uncertain` | PASS（実機で Undo 無効の巻き戻り検出、Undo 有効・Undo 後・2 人で誤検知なし） |
| 既存 58 テストを含む回帰・Docker 成功、新規回帰 0 | PASS。coach 86 件全件成功。サーバー全体の唯一の失敗は既存の AI 対局タイムアウト（起点でも発生）。クライアント・CSS lint も起点と同一 |
| 既存 JSONL を消去せず読み続ける | PASS。権限のみ是正、内容は不変。旧形式は `legacy-content-only` |
| LLM・ゲーム操作・勝敗への影響 0 | PASS（本体無変更、LLM 呼出しなし） |
| トレース無効時の余計な I/O なし、異常時もゲーム継続 | PASS（`COACH_TRACE_DIR` 未設定ならストアを作らない。書込失敗・拒否時もゲームは継続） |
| 4 文書の作成、静的/実機の区別・SHA・測定結果 | PASS（本書・design・qa・gaps、加えて operations.md） |

## 3. 測定

| 項目 | 値 |
|---|---|
| 状態取得（11 MB 履歴のゲーム） | p95 3.4 ms |
| 履歴一覧 | p95 57.6 ms |
| 位置参照 | p95 106.7 ms（最適化前 243.9 ms） |
| 履歴 API を連続取得中の状態取得 | p95 57.8〜87.8 ms（目標 200 ms 以内） |
| 実機 liveCheck | ソロ 1,253、2 人 Undo 5,406、Docker 647、利用者ゲーム read-only 392 チェック、失敗 0 |

## 4. 実施中に見つけた事項

| 事項 | 対応 |
|---|---|
| 既存トレースが 0664/0775（umask 0002）で他ユーザーから読めた | 新コードの起動時に 0600/0700 へ是正（実機確認） |
| 位置参照が全スナップショットを解析し 244 ms かかった | 指紋を含む行だけ解析するよう変更し 107 ms |
| 2026-10-14 07:54 にタブレットで作成されたゲームが Undo 無効 | 作成画面が前回設定を復元するため。利用者に告知（次回一度有効にする） |
| 異なるゲームの ID を 1 回の liveCheck に渡すと他プレイヤー比較が誤って失敗 | 手順の誤り。ゲームごとに実行し直して失敗 0（証跡は分けて保存） |

## 5. 完了判定

**完了**。DoD の全項目を満たした。残る制約（他 UID 所有ファイルの実 UID 試験、親経路のリンク、履歴 API の同期読込と索引化、容量管理）は [phase1.5-gaps.md](phase1.5-gaps.md) に記録した。Phase 2 には着手していない。

## 6. 次の手順

- 利用者: 次のゲーム作成時にタブレットで「Allow undo」を一度オンにする。
- 点検: `npx tsx scripts/coach/verifyTrace.ts ~/work/coach-trace`（読み取り専用）
- push は未実施（指示があれば `git push -u origin coach/phase1.5`）。
