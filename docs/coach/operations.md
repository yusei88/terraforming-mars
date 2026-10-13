# コーチ判断履歴（coach-trace）運用手順

対象: Phase 1.5 以降の `COACH_TRACE_DIR`。履歴ファイルには**全プレイヤーの非公開情報（手札・提示カード）**が入る。

## 1. 有効化と保存先

| 環境 | 設定 |
|---|---|
| npm（g10） | `COACH_TRACE_DIR=$HOME/work/coach-trace npm start` |
| Docker Compose | compose の上書きで `environment: COACH_TRACE_DIR: /usr/src/app/db/coach-trace`（`tm-db` ボリューム内） |
| 無効 | 未設定または空文字。この場合コーチはファイルを一切開かない |

ファイル: `<dir>/<gameId>.trace.jsonl`（イベント）、`<dir>/<gameId>.states.jsonl`（スナップショット）。ファイル名にゲーム ID が入るため、**フォルダ一覧も秘密情報**として扱う。

## 2. 権限（P1.5-01）

起動時（最初の記録前）に自動で次を行う。

| 対象 | 動作 |
|---|---|
| フォルダが無い | 0700 で作成 |
| フォルダが自分の所有で 0700 以外 | 0700 に変更（件数を `health.permissionsFixed` に計上） |
| フォルダがシンボリックリンク / ディレクトリでない / 他ユーザー所有 / 確認できない | **記録を停止**（`health.status: refused`）。ゲームは継続 |
| 既存の `*.trace.jsonl` / `*.states.jsonl`（自分の所有の通常ファイル） | 0600 に変更 |
| 既存のそれらがシンボリックリンク / 通常ファイルでない / 他ユーザー所有 | そのゲームの記録だけ停止（`health.filesRefused`）。ファイルは変更しない |
| 上記パターン以外のファイル | 一切触れない |
| 新規ファイル | 0600、`O_NOFOLLOW` で作成（リンクを辿らない）。開いた後に所有者・種別・モードを再確認 |

ログには errno 名だけを出し、パスやゲーム ID は出さない（例: `coach trace: write failed (ENOSPC)`）。

確認:
```bash
stat -c '%a %U %n' ~/work/coach-trace ~/work/coach-trace/*.jsonl
```

## 3. 書込失敗と破損（P1.5-05）

- 書込順は「スナップショット → イベント」。スナップショットの保存に失敗したイベントは書かない（`health.eventsDropped`）。孤立したスナップショットは許容し、参照先のないイベントは作らない。
- `seq` は書込に成功したイベントにだけ割り当てる。失敗後の再試行は同じ番号から続く。
- 失敗の件数は `GET /api/coach/decisions?id=<自分のID>` の `health.writeFailures` で確認できる（errno 名ごと）。
- クラッシュや容量不足で最終行が途中で切れた場合、次の追記の前に改行を補い、切れた行を単独の不正行として**隔離**する（既存の行は書き換えない）。読み込み時は不正行を数えて飛ばす（`health.corruptLinesSeen`）。

## 4. 点検と修復

点検（読み取り専用。権限も内容も変えない）:
```bash
cd ~/work/terraforming-mars && npx tsx scripts/coach/verifyTrace.ts ~/work/coach-trace
```
`danglingRefs`（参照先のないイベント）と `fingerprintMismatches`（内容と指紋の不一致）は 0 でなければならない（終了コード 1）。`corruptLines` は隔離済みの切れた行で、残っていても読み込みに支障はない。

修復手順（必要なときのみ。サーバーを止めてから行う）:
1. フォルダごとバックアップ: `tar czf ~/work/coach-backup/coach-trace-$(date +%Y%m%d%H%M).tgz -C ~/work coach-trace` → `chmod 600` で保護
2. 不正行を取り除く場合は、**新しいファイルに有効な行だけを書き出して置き換える**（元ファイルは手順1のバックアップに残る）。イベントの `seq` は振り直さない
3. `verifyTrace.ts` で 0 件を確認してからサーバーを起動

## 5. 履歴の信頼度（P1.5-02）

`GET /api/coach/decisions?id=<ID>` の `history.status`:

| 値 | 意味 | AI 側の扱い |
|---|---|---|
| `valid` | 記録とゲームが矛盾しない | 通常どおり利用 |
| `rollback-detected` | ゲームが記録より前に戻った（Undo 無効ゲームの再起動・キャッシュ再読込など） | 巻き戻り以降の旧判断（`series: superseded`）を確定判断として使わない |
| `uncertain` | 判定できない | 該当判断（`series: unverified`）を確定扱いしない |
| `disabled` | 記録が無効 | 履歴に基づく助言をしない |

読み取りでは何も記録しない。不一致は**次の回答時**に `integrity` イベントとして一度だけ記録され、巻き戻りなら新しい分岐（branch）が始まる。古いイベントは削除しない。

Undo を有効にして遊ぶ運用（Phase 1 で決定）が前提。自動復元やゲームの巻き戻し操作は行わない。

## 6. 履歴の参照（P1.5-04）

- 判断の時点の状態: `GET /api/coach/decisions?id=<ID>&seq=<n>&position=before|after|from|to|observed`
  - `reference` がその判断の正しい位置（seq・branch・version・stateKey・series）。`snapshot` の `version`・`stateKey`・`capturedAt` もその位置の値に置き換えて返す。最初に保存した時点の値は `firstCapture`
  - `precision: legacy-content-only` は Phase 1 の記録（警告の有無までは再現できない）
- 内容だけの検索（Phase 1 互換）: `&fingerprint=<sha256>`。同じ内容は履歴上に何度も現れ得るため、**どの時点かは決まらない**
