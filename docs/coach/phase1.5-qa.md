# Phase 1.5 QA — H01〜H18

実施日: 2026-10-14 / 環境: g10（Ubuntu 24.04、Node v24.13.0）、Docker（Node 22、ユーザー `tfm`）
ブランチ `coach/phase1.5`、起点 `c2944817c`（コミット SHA は [報告](phase1.5-report.md) に記載）

試験区分: **U** 単体 / **I** 実ゲームを使う統合（テスト用 DB・状態構築あり）/ **L** 稼働サーバーへの実機検証（HTTP・プロセス再起動・別 UID・Docker）。
実機検証に使ったゲームはすべて API で作った**捨てゲーム**。利用者のゲームは `--read-only` でのみ照合した。

## 1. シナリオ結果

| ID | 分類 | 手順 | 合格条件 | 方法 | 結果 | 証跡 |
|---|---|---|---|---|---|---|
| H01 | 権限 | `umask 022` で新規トレース書込 | dir=0700 / files=0600 | U, L | PASS | `traceStore.spec › creates the folder 0700…`。実機: 別 UID（`nobody`、Docker で同フォルダをマウント）から `ls`・`cat` とも Permission denied、本人 UID は 8 ファイル列挙可 |
| H02 | 権限 | 既存 0644 ファイルがある状態で起動 | 安全に保護・無断漏えいなし | U, L | PASS | `restricts existing trace files…`（無関係ファイルは 0644 のまま）。実機: g10 のフォルダ 0775→0700、8 ファイル 0664→0600（`p15-h02-modes-before.txt`）。Docker の既存ボリューム 0755/0644→0700/0600（`permissionsFixed: 3`） |
| H03 | 権限 | 書込先シンボリックリンク / 所有者違い | 対象を変更せず拒否・ゲーム継続 | U | PASS | ファイルのリンク（起動時・起動後に作成の両方）、フォルダのリンク、他者所有フォルダ（`process.getuid` を差し替えて再現）で拒否、リンク先の内容・モード不変、他ゲームは記録継続。**実 UID の異なる所有者による試験は root 権限が必要なため未実施** |
| H04 | 障害 | ENOSPC/EACCES を書込時に注入 | 保存失敗が分かり、ゲーム入力は成功 | U | PASS | `reports write errors and keeps the game going`（カード効果は適用、`writeFailures.ENOSPC: 1`、`eventsDropped: 1`）、`reports a folder that became unwritable (EACCES)`（実際に 0500 にして発生） |
| H05 | 障害 | states 保存失敗 | その状態を参照する trace は作られない | U, I, L | PASS | `never writes an event whose snapshot could not be stored`（1 枚目・2 枚目の失敗、再試行で seq 1）。実機: 全 11 ゲームで参照先不明イベント 0（`verifyTrace`） |
| H06 | 障害 | JSONL 末尾を破損して再起動 | 次の正常行を破壊しない・診断記録 | U | PASS | `isolates a cut last line…`（既存バイト不変、改行補完、`corruptLines: 1`、`tornLinesIsolated: 1`） |
| H07 | 変更検知 | 同一状態で警告だけ変更 | stable 同一・advisory 変化 | U | PASS | `keeps the content fingerprint when only a warning changes`（警告を消すと advisory も元に戻る） |
| H08 | 変更検知 | 手札/資源/選択肢を変更 | stable 変化・同一読取は不変 | U, L | PASS | `changes both when…`、`can be recomputed from the snapshot (contract)`。実機: 二重読取で両指紋一致（liveCheck 全手） |
| H09 | 履歴 | 判断→Undo→同じ状態へ再到達 | seq/branch/状態参照が正しい | I, L | PASS | `keeps each event at its own place…`（seq2: branch0・superseded、seq4: branch1・current、同じ fingerprint でも version/stateKey はそれぞれの値）。実機 H14 ゲームでも同じ系列 |
| H10 | 履歴 | Phase 1 の旧 JSONL を新実装で参照 | 旧データも読める・古い位置情報を捏造しない | I, L | PASS | `reads Phase 1 records and continues them`（`precision: legacy-content-only`、advisory を捏造しない、seq 継続）。実機: Phase 1 の 4 ゲーム・1,015 スナップショットすべて新コードで fingerprint 再計算一致、参照先不明 0（`p15-h10-verify-before.json`） |
| H11 | 認可 | A から B の seq/fingerprint 参照 | 参照不可、漏えい 0 | I | PASS | `never returns another player's event or snapshot`（seq・fingerprint とも 404、一覧に B の指紋なし、不正 position/seq は 400） |
| H12 | 復元 | Undo 無効・手番途中で再起動 | 後退が検出され、古い意思決定に警告 | I, L | PASS | `detects a rollback after a restart of a game without undo, read-only first`。実機: 発電所建設後にサーバー再起動 → 読取 2 回とも `rollback-detected`（記録は増えない）→ 次の回答で integrity 記録、旧判断 seq2 が `superseded`、新判断は branch 1 |
| H13 | 復元 | Undo 有効・正常セーブ後に再起動 | 誤った rollback 判定なし | I, L | PASS | `finds no rollback after a restart of a game with undo`。実機: 再起動前後とも `valid` |
| H14 | 復元 | 通常の Undo/Cancel 後に再起動 | 明示的 revert を重複記録しない | I, L | PASS | 統合試験 H09 の後半。実機: Undo→再起動→回答で revert は 1 件のまま、integrity なし |
| H15 | 復元 | 2 人対局・相手の操作後 | 通常更新を rollback と誤認しない | U, I, L | PASS | `does not take other players' moves for a rollback`、`does not compare content after another player acted`。実機: 2 人ゲームで両者とも再起動前後 `valid`、2 人 Undo ゲーム 224 手で integrity 0 |
| H16 | 性能 | 通常 API と履歴 API を継続照合 | 状態取得 P95 200 ms 以内、ゲーム操作を阻害しない | L | PASS | 最大の Phase 1 ゲーム（states 11 MB）で: state p95 3.4 ms、一覧 p95 57.6 ms、位置参照 p95 106.7 ms（改善前 243.9 ms）。一覧を連続取得中の state p95 57.8 ms、位置参照を連続取得中の state p95 87.8 ms |
| H17 | Docker | 非 root・既存ボリュームで再作成 | 0600/0700 維持、書込・再開正常 | L | PASS | 既存ボリュームをバックアップ後に再ビルド。`tfm` で 0700/0600 に是正、40 手・647 チェック失敗 0、コンテナ再起動後 `valid`・seq 継続（41→47）、新規ファイルも 0600 |
| H18 | 回帰 | 基本ソロ、2人、Undo、タブレット（read-only） | Phase 1 の主要シナリオが PASS | U, L | PASS | Phase 1 の 58 テスト全件成功（新規 28 件と合わせ 86 件）。実機: ソロ 77 手 1,253 チェック失敗 0、2 人 Undo 224 手 5,406 チェック失敗 0、利用者の 2 ゲームを read-only で 186 + 206 チェック失敗 0・`history: valid` |

## 2. 自動試験

| 試験 | 結果 | 備考 |
|---|---|---|
| coach テスト（mocha） | **86 passing / 0 failing** | Phase 1 の 58 + 新規 28（traceStore 9、integrity 9、history 7、指紋 3） |
| ミューテーション確認 | 2 件とも検出 | 巻き戻り判定を無効化 → 2 件失敗、状態保存失敗を無視 → 2 件失敗（元に戻して確認） |
| `npm run test:server` | 7,803 passing / 1 failing | 失敗は既存の AI 対局テスト（60 秒タイムアウト）。単独実行でも失敗し、Phase 1 起点でも発生。本変更は AI・本体に触れていない |
| `npm run test:client` | 1,225 passed / Errors 1 | Vitest teardown（起点と同一） |
| `npm run build` | 成功 | webpack 警告 3（既存） |
| eslint / i18n / vue-tsc | 成功 | |
| `lint:css` | 6 件（既存 .less、起点と同一） | |
| `tsc --build tests/tsconfig.json` | 既存 3 件のみ | |

## 3. 実機で未実施・制限

- H03 の「実際に別 UID が所有するファイル」: root 権限なしでは作れないため、UID 判定の差し替えで代替。別 UID からの**読取拒否**は実機で確認済み。
- AI 対戦相手を含むゲームでの巻き戻り判定（AI の手は人間の記録がないため前進として扱う設計。単体試験 H15 で相手の未記録の手を確認）。

## 4. 証跡

`docs/coach/evidence/`（ID は含まない）: `p15-live-solo-undo.json`、`p15-live-2p-undo.json`、`p15-live-docker.json`、`p15-live-user-a-readonly.json`、`p15-live-user-b-readonly.json`。
g10 `~/work/coach-logs/`: `p15-*.log`（全試験ログ）、`p15-h02-modes-before.txt`、`p15-h10-verify-before.json`、`p15-verify-after.json`、`p15-h17-volume-before.txt`。
バックアップ（0600、`~/work/coach-backup/`）: Phase 1 時点の npm 側トレース、Docker ボリューム側トレース。
