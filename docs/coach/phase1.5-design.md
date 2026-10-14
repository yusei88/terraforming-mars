# Phase 1.5 設計 — 履歴の機密性・整合性・復元可能性・変更検知

計画: `TM-COACH-P1.5`（2026-10-14）。ブランチ `coach/phase1.5`、起点 `c2944817c`。
関連: [QA](phase1.5-qa.md) / [報告](phase1.5-report.md) / [未対応](phase1.5-gaps.md) / [運用手順](operations.md)

## 1. 変更の範囲

| パッケージ | 実装 | ファイル |
|---|---|---|
| P1.5-01 アクセス制御 | 0700/0600、リンク・他者所有の拒否、`O_NOFOLLOW`+`fstat` 再確認、ログに ID を出さない | `server/traceStore.ts`（新規） |
| P1.5-05 耐障害性 | `append()` が成否を返す契約、スナップショット→イベントの順序、成功時のみ `seq` 確定、切れた行の隔離、健全性カウンタ | `server/traceStore.ts`、`server/coachTrace.ts` |
| P1.5-03 指紋の分離 | `advisoryFingerprint` を追加（`fingerprint` は不変） | `common/CoachState.ts`、`server/fingerprint.ts`、`server/projectCoachState.ts` |
| P1.5-04 内容と位置の分離 | `seq`+`position` によるスナップショット参照、参照値で上書きして返却、`legacy-content-only` 表示、重複排除キーに advisory を追加 | `common/CoachTrace.ts`、`server/coachTrace.ts`、`server/routes.ts` |
| P1.5-02 整合性検査 | `assessIntegrity`（読み取り専用）、次の記録時に `integrity` イベント、`annotateSeries`（current/superseded/unverified） | `server/integrity.ts`（新規）、`server/coachTrace.ts`、`server/routes.ts` |
| 運用 | 読み取り専用の点検ツール | `scripts/coach/verifyTrace.ts`（新規）、`docs/coach/operations.md` |

ゲーム本体（`src/server/` 以下のコーチ以外）は**変更なし**。`inputObservers.ts` も変更不要だった。

## 2. P1.5-01 / P1.5-05 トレース保存

```
TraceSink = {
  append(gameId, file, record): {ok: true} | {ok: false, code}   // code は errno 名のみ
  read(gameId, file): {records, corruptLines, error?}
  health(): {status: ok|degraded|refused, writeFailures{code:n}, tornLinesIsolated,
             corruptLinesSeen, permissionsFixed, filesRefused, refusedReason?}
}
```

- 起動時: フォルダを `lstat`。無ければ 0700 で作成し `chmod` で明示設定。リンク・非ディレクトリ・他者所有は拒否（以後の書込はすべて `EREFUSED`）。自分の所有なら 0700 に是正。`^[A-Za-z0-9_-]+\.(trace|states)\.jsonl$` に一致するファイルだけを検査し、自分の通常ファイルは 0600 に是正、それ以外は拒否リストへ。無関係なファイル・親フォルダには触れない。
- 追記: `O_RDWR|O_APPEND|O_CREAT|O_NOFOLLOW`、モード 0600 で開き、`fstat` で通常ファイル・所有者を再確認（開いた後の差し替え対策）。末尾 1 バイトが改行でなければ改行を前置して切れた行を隔離。`writeSync` の書込バイト数を検証。
- 読込: 同じく `O_NOFOLLOW`。JSON でない行は数えて飛ばす。
- トレーサ: `keepState()` は保存成功後にだけ既知集合へ登録。イベントは参照する全スナップショットの保存に成功した場合のみ書く。`emit()` は `seq = cursor.seq + 1` で書き、成功したら確定。失敗はカウントのみでゲームは止めない。

保証: 孤立スナップショットは起こり得るが、参照先のないイベントは作らない。成功していない書込を成功と報告しない。

## 3. P1.5-03 二つの指紋

| | `fingerprint`（既存） | `advisoryFingerprint`（新規） |
|---|---|---|
| 入力 | `{game, me, opponents, choices}` から `warnings`・`canCancelAction` を除外 | `{game, me, opponents, choices, warnings}` すべて（警告・取消可否を含む） |
| 除外 | 時刻、バージョンカウンタ、タイマー（元から含まない） | 同左 |
| 用途 | 局面の事実に基づく計算のキャッシュキー | 今の選択肢・注意喚起を伴う助言を作り直すかの判定 |
| 再起動 | 不変 | 一時警告が消えれば変わり得る（異常ではない） |

`coach-state/1` への**追加フィールド**として導入（スキーマ名は据え置き、既存フィールドは不変）。既存 `fingerprint` の計算は 1 行も変えておらず、Phase 1 で保存した 1,015 件のスナップショットすべてで新コードの再計算値が一致した（QA H10）。両指紋はスナップショット本文から再計算できる（契約テスト）。

## 4. P1.5-04 内容と履歴位置

- スナップショットの重複排除キーを `(color, fingerprint, advisoryFingerprint)` に変更。Phase 1 の記録（advisory なし）はキー `(color, fingerprint, '')` として扱う。
- イベントの参照（`CoachStateRef`）に `advisoryFingerprint` を追加。イベントごとの `seq`・`branch`・`stateKey`・`version` がその時点の正しい値。
- `GET /api/coach/decisions?id=&seq=&position=` → `CoachHistorySnapshot`:
  - `reference`: イベントの参照値 + `seq`, `position`, `recordedAt`, `series`
  - `snapshot`: 保存本文の `version`・`stateKey`・`capturedAt` を参照値（`capturedAt` はイベントの記録時刻）で置き換えたもの
  - `firstCapture`: 本文を最初に保存した時点の `capturedAt`・`stateKey`
  - `precision`: `exact`（advisory まで一致）/ `legacy-content-only`（Phase 1 記録）
- `position`: decision=`before|after`、rejected=`before`、revert=`from|to`、integrity=`observed`。
- 他プレイヤーのイベントの `seq` を指定すると 404（色で所有者を照合）。
- `?fingerprint=` は互換のため維持。内容だけの検索で、時点は決まらないと明記。
- ブランチ番号の復元は Phase 1 の「成功した revert の数」から「全参照の最大 branch」に変更（integrity でも分岐するため）。Phase 1 ファイルでは同じ値になる。

## 5. P1.5-02 整合性検査

**確定済み進捗**: `decision.after`、`revert.to`（成功時）、`integrity.observed`。`rejected` と失敗した revert は含めない。

判定（`assessIntegrity(events, 現在の状態)`、カウンタ = generation・gameStep・gameAge）:

| 条件 | 結果 |
|---|---|
| 記録なし | `valid` |
| どれかが後退し、前進がない | `rollback-detected`（undoCount が記録なしに増えていれば理由に追記） |
| 後退と前進が混在 | `uncertain` |
| すべて同じで、同じプレイヤーの最後の確定状態と内容が違い、かつその後に他プレイヤーのイベントがない | `uncertain` |
| それ以外（同じか前進） | `valid`（他プレイヤーの手・AI の手・自動処理は前進として扱う） |

- 読み取り（`GET /api/coach/decisions`）は判定を返すだけで何も書かない。
- 記録は次の安全な書込時（回答・revert の直前）に毎回判定し、問題があれば `integrity` イベントを 1 件書く。巻き戻りなら新しい branch を開始。記録後は `observed` が確定状態になるため同じ不一致を繰り返し記録しない。
- 計画では「起動後の初回観測時」だったが、毎回の記録時に判定する方式とした。理由: `GameLoader` はアイドルなゲームをキャッシュから外し、次のアクセスで DB から読み直すため、サーバー再起動がなくても Undo 無効ゲームは巻き戻り得る。判定はカウンタ比較のみで軽い。
- `annotateSeries`: revert（to あり）または rollback-detected の目標状態より先にある同一 branch のイベントを `superseded`、uncertain の対象（最後の確定イベント）を `unverified`。それ以外は `current`。古いイベントは削除しない。

## 6. Phase 2 への受け渡し契約

| 知りたいこと | 使う値 |
|---|---|
| 現在の確定ゲーム状態 | `CoachStateV1.fingerprint` |
| 助言を更新すべきか | `CoachStateV1.advisoryFingerprint` と `choices` |
| 履歴上の判断の状態 | イベントの `seq` + `position` + `branch` + `CoachStateRef`（`?seq=&position=` で取得） |
| 履歴の信頼度 | `history.status`: `valid` / `rollback-detected` / `uncertain` / `disabled`、各イベントの `series` |
| 記録の健全性 | `health`（status・writeFailures・eventsDropped など） |
| 未解析カード | カタログの `bespokeHooks` / coverage（Phase 1 から不変） |

`series` が `current` 以外の判断、`history.status` が `valid` 以外の区間は、戦略学習・振り返りで確定事実として使わない。API が失敗したら、推奨を断定しない。
