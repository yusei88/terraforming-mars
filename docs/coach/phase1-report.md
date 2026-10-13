# Phase 1 完了報告 — Terraforming Mars AI Strategy Coach

対象: g10 `~/work/terraforming-mars`、ブランチ `coach/phase1`（起点 `fd22ef8b5`、未コミット・未 push）
関連: [設計](phase1-design.md) / [データカタログ](phase1-data-catalog.md) / [QA](phase1-qa.md) / [未対応・リスク](phase1-gaps.md)

## 1. 実装結果

### 完了した機能
- **CoachStateV1 投影**（`coach-state/1`）: プレイヤー画面と同じ `PlayerViewModel` を正規化。ゲーム共通・自分・他プレイヤー（公開情報のみ）・現在の選択肢・状態識別（fingerprint / stateKey / version）・品質警告
- **選択肢の正規化**: `waitingFor` を `path` 付きの木に変換。or/and/initialCards/option/card/projectCard/space/payment/player/amount/resource/resources に対応、それ以外は `unsupported` と警告
- **カードカタログ**（`coach-catalog/1`）: 全 998 枚をカードクラスから実行時生成。Behavior DSL・静的効果・カード固有コードの有無（`bespokeHooks`）・網羅度（coverage）を明示
- **判断履歴**（`coach-trace/1`）: 判断前後の状態参照、提示選択肢、回答、時刻、不正入力（`rejected`）、Undo/取消（`revert` と単調な `branch`）を JSONL に記録。再起動後も連番・分岐番号を継続
- **API**: `GET /api/coach/state`、`GET /api/coach/catalog`、`GET /api/coach/decisions`
- **検証基盤**: 新規 58 テスト、実サーバー検証スクリプト `scripts/coach/liveCheck.ts`

### 変更ファイル
本体（既存ファイルの変更 +27/−1 行）:
- `src/server/routes/PlayerInput.ts` — 回答前後・Undo 前後の観測通知（例外は従来どおり再スロー）
- `src/server/routes/CancelAction.ts` — アクション取消前後の観測通知
- `src/server/extensions/ServerExtension.ts` — `inputObserver` を追加
- `src/server/server/requestProcessor.ts` — 拡張のオブザーバを登録
- `src/server/cards/Card.ts` — 要件緩和効果の読み取り専用ゲッター

新規:
- `src/server/extensions/inputObservers.ts`
- `src/extensions/coach/`（extension.server.ts、common/ 3 ファイル、server/ 8 ファイル）
- `tests/extensions/coach/`（spec 6 ファイル + ユーティリティ）
- `scripts/coach/liveCheck.ts`、`scripts/coach/autopilot.ts`
- `docs/coach/`（本書を含む 5 文書、`evidence/` に匿名化済み証跡 6 ファイル）

### 重要な設計判断
1. **拡張機構に載せる**: フォーク既存の `src/extensions/<name>/extension.server.ts` を使い、本体変更をフック 1 種類に限定。フォーク更新の取り込みが容易
2. **合法手は `waitingFor` だけを根拠にする**: `canPlay()` は警告付与の副作用があるため呼ばない。手札（将来の可能性）と `choices`（今の合法手）を型で分離
3. **ゲーム ID も秘密扱い**: `api/game?id=` が全プレイヤー ID を返すことを確認したため、スナップショット・履歴から全 ID を排除
4. **非公開値は `hidden`**: 相手 VP のゼロ埋めを `{status:'hidden'}` に変換
5. **既存 humanDecisionTrace は変更せず並行記録**: 判断後状態・Undo・不正入力・ID 排除が必要なため。二段階コールバック等の設計は踏襲
6. **fingerprint から揮発値を除外**: `canCancelAction` とカード警告は再起動で失われるため除外。これにより「再起動後に同じ fingerprint」を保証（実測）

## 2. 取得できるデータ

| 分類 | 内容 |
|---|---|
| ゲーム状態 | 設定・拡張、ソロ/対人、世代・フェーズ、温度/酸素/海洋（値・最小・最大・残りステップ）、Venus（有効時）、全マス（座標・種別・ボーナス・隣接・タイル・所有者）、称号・褒賞（達成者・各自スコア）、山札・捨て札枚数、手番・パス状況、終局・ソロ勝敗、バージョン情報 |
| 自分 | 企業、資源 6 種と生産、鋼鉄/チタン価値、TR、VP 内訳、タグ、手札（計算後コスト）、プレイ済みカード（カード上資源・割引・無効化）、使用済みアクション、手番内行動数、プレリュード/CEO 手札、ドラフト済み、初期配布履歴、保護状態 |
| 他プレイヤー | 名前・色・公開資源・生産・TR・タグ・プレイ済みカード・手札枚数・使用済みアクション・都市数・パス状況。VP は条件付きで `known` / `hidden` |
| カード・コンボ分析 | カタログ（コスト、タグ、要件、VP 規則、資源種、割引、Behavior DSL の onPlay/action/firstAction、静的効果、カード固有フック一覧、coverage）。基本セット 148 枚中、プレイ効果 105 枚が完全宣言的、アクション 23 枚中 20 枚が宣言的 |
| 現在の選択肢 | `choices.root` 以下の木（path、型別の候補カード・合法マス・支払手段・最小最大）。`projectCard.cards` は今プレイ可能なカードのみ |
| 判断履歴 | `decision`（before/after 参照、offered、response、askedAt/decidedAt/thinkingMilliseconds）、`rejected`、`revert`（undo / cancel-action、from/to、branch）。状態本体は fingerprint で引ける |

## 3. テスト結果

| 試験 | 結果 |
|---|---|
| 新規 coach テスト | **58 passing / 0 failing** |
| `npm run test:server`（全体） | **7,776 passing / 0 failing**（途中の実行では既存の時間依存 AI テストが 1 件タイムアウト。起点コミットでも同事象） |
| `npm run test:client` | 1,225 passed（Vitest teardown の未処理エラー 1 件は起点コミットでも発生） |
| `npm run build` | 成功 |
| `npm run lint` | eslint・i18n・vue-tsc 成功。`lint:css` は既存 .less の 6 件で失敗（起点でも同一） |
| 実機 E2E（UI で作成した基本セット・ソロ） | 110 手・1,781 チェック・失敗 0・HTTP p95 4.4 ms、終局まで |
| 実機 E2E（UI で作成した 2 人・ドラフト・Undo） | 542 手・14,406 チェック・失敗 0・HTTP p95 3.9 ms、Undo の分岐記録を確認 |
| 実機: 対局中のサーバー再起動 | fingerprint・stateKey 一致、履歴継続 |
| Docker Compose（Node 22） | 終局まで 77 手・1,404 チェック・失敗 0 |
| タブレットで作成・プレイ中のゲーム（読み取り専用） | 806 チェック・失敗 0、タブレット操作 14 判断を連鎖記録 |
| シナリオ S01〜S31 | **PASS 31 / FAIL 0** |

**実機で残っている任意項目**: Initial Draft・AI 混在の対局（V-3, V-5）。

**発見した不具合と対応**
| 内容 | 対応 |
|---|---|
| カタログで Adaptation Technology / Special Design の効果が機械可読情報に現れていなかった（自己レビューで発見） | `staticEffects` を追加し、「効果情報が一切ない基本カードは VP のみのカード 4 枚だけ」をテストで固定 |
| 最終生産中に `waiting-for-others`（空）となり意味が曖昧 | `resolving` 状態を追加 |
| 研究フェーズ中にゲームを直列化→復元すると別のカードが配られる | 本体はセーブ後に配布するため、実際の再起動では同じ提示になることを実セーブで確認。試験方法を「最終セーブからの復元」に修正 |
| テスト基盤: `InMemoryDatabase.saveGameResults` 未実装で終局処理が止まる | 通し試験でサブクラス化して回避（本体は無変更） |
| Docker イメージのビルド失敗（`scripts/coach/liveCheck.ts` が Docker で除外される `tests/` を参照） | 自動回答を `scripts/coach/autopilot.ts` に移動。再ビルド成功 |

## 4. リスク・未対応

- **データ欠落**: カード固有コードのみで実装された効果（基本セットでプレイ効果 16 枚・アクション 3 枚に何らかのコード）。手札カードの「不足条件」は未計算。拡張固有状態（コロニー、ターモイル等）は `unsupported` として明示のみ
- **制約**: Undo 無効ゲームは手番開始時しかセーブされないため、サーバー再起動で巻き戻り、判断履歴に巻き戻りイベントが残らない（E-2）。`undoCount` は単調でない（`branch` で補完済み）
- **セキュリティ**: プレイヤー URL の ID が唯一の認可（既存と同等）。LAN 上は HTTP 平文。履歴ファイルは全員の手札を含むためファイル権限で保護。インターネット公開は不可
- **Phase 2 で必要な追加開発**: Behavior DSL 要約器、要件充足の差分計算、数世代シミュレーション、LLM 向けデータ選別、巻き戻り検出、トレース索引化、履歴閲覧 UI（16 言語翻訳）。詳細は [phase1-gaps.md §7](phase1-gaps.md)

## 5. Phase 1 完了判定

**完了**（E-2 は Phase 2 への申し送り）

理由:
- 完了条件のうち、主要状態の画面モデルとの一致（実機 16,000 件超の照合で不一致 0）、基本セット全カードの識別、未解析部分の明示（coverage・bespokeHooks・staticEffects・unsupported）、現在の選択肢の取得（選択肢だけで終局まで回答可能）、判断履歴の保存・追跡、Undo・再開への対応、相手の秘密情報の非漏えい、読み取りの無副作用、ゲーム本体の正常動作（既存テスト全件成功）、試験結果と証跡、P95 200 ms 以内（実測 4〜5 ms）を満たした
- 前回の条件だった Docker Compose 環境と実機タブレットでの検証も実施し、失敗 0 だった
- Undo 無効時の再起動巻き戻りを履歴が検出しない制約（E-2）は Phase 1 の取得基盤の範囲外として申し送る

## 6. ユーザーが次に実行する手順

### サーバー起動後の確認コマンド
g10 で（トレースを有効にして起動する場合）:
```bash
cd ~/work/terraforming-mars && COACH_TRACE_DIR=$HOME/work/coach-trace npm start
```
別端末から（`<playerId>` はプレイヤー URL の `id=` の値）:
```bash
curl -s http://192.168.3.25:8081/api/coach/catalog | head -c 200
```
```bash
curl -s "http://192.168.3.25:8081/api/coach/state?id=<playerId>" | python3 -m json.tool | head -60
```
```bash
curl -s "http://192.168.3.25:8081/api/coach/decisions?id=<playerId>" | python3 -m json.tool | head -40
```

### 実機検証の進め方
自動照合（進行中のゲームには `--read-only` を付ける。付けないとスクリプトが手を打つ）: 新規ゲームを UI で作成し、g10 で
   ```bash
   cd ~/work/terraforming-mars && npx tsx scripts/coach/liveCheck.ts --base http://localhost:8081 --out /tmp/evidence.json <playerId> [<playerId2>]
   ```
   `"failed": 0` を確認（Undo 有効ゲームでは `--undo-at 10` で Undo も検証）

### Phase 2 へ移行するための条件
- E-2（再起動巻き戻り）: **決定済み**。Undo 有効でのプレイを標準とし、作成画面の既定値を Undo 有効に変更（各端末は前回の設定を復元するため、既に使った端末では一度 Undo を有効にして作成する）
- 変更のコミット（現在は `coach/phase1` ブランチ上で未コミット）
