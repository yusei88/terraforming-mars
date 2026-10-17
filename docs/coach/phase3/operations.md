# Phase 3 運用（外部 AI の有効化）

外部 AI は**既定でオフ**。オンにするには、サーバーの設定、キー、利用者の同意（パネルのチェック）の 3 つが要る（[設計 §6](choice-driven-design.md)）。

## g10 で有効にする

キーは `~/.config/tm-coach/openai.env`（権限 600、Git 管理外）に置く。値を画面やログに出さないよう、ファイルを環境変数として読み込んで起動する。

```bash
cd ~/work/terraforming-mars
set -a; . ~/.config/tm-coach/openai.env; set +a
COACH_TRACE_DIR=$HOME/work/coach-trace COACH_AI_ENABLED=true COACH_AI_EXTERNAL_ALLOWED=true nohup npm start >> ~/work/tm-server.log 2>&1 &
```

無効に戻すには、`COACH_AI_ENABLED` を付けずに起動し直す。キーを読み込まなければ、プロセスにキーは渡らない。

## 設定

| 変数 | 既定 | 内容 |
|---|---|---|
| `COACH_AI_ENABLED`、`COACH_AI_EXTERNAL_ALLOWED` | `false` | 両方 `true` で有効（キーも必要） |
| `COACH_AI_PROVIDER` | `openai` | `openai` または `sarashina` |
| `COACH_AI_MODEL` | `gpt-6.1-sol` | 暫定のデフォルト（[ADR](adr-provider.md)） |
| `COACH_AI_REASONING_EFFORT` | `low` | OpenAI のみ |
| `COACH_AI_TIMEOUT_MS` | 30000 | 1 回の呼び出しのタイムアウト |
| `COACH_AI_MAX_OUTPUT_TOKENS` | 2000 | 出力の上限 |
| `COACH_AI_MAX_CALLS` | 200 | プロセス内のモデル呼び出しの上限（全プレイヤー合計。再起動で戻る） |
| `COACH_COUNSEL_PER_MINUTE` | 10 | プレイヤーあたり、毎分の検討の上限 |

## 注意

- **送るもの**: 同意した利用者の局面だけ（自分の手札を含む）。ID、相手の手札、山札は送らない。
- **Sarashina**: 無料プランでは入力が学習に使われることがある。実際の対局では使わない。
- **費用の目安**: `gpt-6.1-sol` で 1 回約 $0.005〜0.01。
- **ログ**: 失敗の分類だけを出し、モデルの文やキーは出さない。
