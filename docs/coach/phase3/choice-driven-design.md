# 選択主導型コーチの設計（TM-COACH-P3-CD）

- 計画: [choice-driven-plan.md](choice-driven-plan.md)（2026-10-16）。着手指示: [choice-driven-prompt.md](choice-driven-prompt.md)。
- 起点: `main` = `5e60b1488`（PR #8、Iteration 0 マージ後）。
- この文書は実装上の決定を記録する。計画と食い違う点は §9 に理由とともに記す。

## 1. 目的

> ゲームが今提示している選択肢をプレイヤー自身が選ぶ。AI はその選択の強み、弱み、先の影響を根拠付きで返し、考えるための問いを 1 つ添える。

**原則**
- **選ぶのは人間。** 選ぶ前に「これが最善」と表示しない。
- **AI は迎合しない。** 不利な点は根拠付きで示す。
- **選ぶことは実行ではない。** コーチ上の選択はゲームを一切変更しない。実行は従来のゲーム画面だけで行う。
- **ルールと数値の正本は、ゲームと Phase 2 の分析。** LLM は数値を作らない。根拠のない数値と最善の断定は表示しない。
- **ボタンだけで一通り使える。** 自由質問（Iteration 0 の `question`/`hint`/`compare`/`explain`）は補助として残し、初期画面には出さない。

## 2. 画面の状態

```
閉じている ──メニュー「Strategy coach」──▶ 選択肢一覧
選択肢一覧: [今できる行動 Now] [将来を見据えたプラン Future]
   │ 選ぶ（ゲームには送らない）
   ▼
選択の確認: 確定事実（費用、可否、関係、分析できる範囲）を即時に表示（API の呼び出しは 1 回、LLM は使わない）
   │「この選択を検討」              │「他案と比較」→ もう 1 つ選ぶ
   ▼                                ▼
検討中（読み込み） ─────────▶ 検討結果: 強み / 注意点 / 先の見通し / 問い 1 つ / 根拠
   ├「根拠を見る」: 事実カードを開閉
   ├「選び直す」: 選択肢一覧へ戻る
   └「閉じる」: ゲームへ戻る
```

**データ付きで表示する特別な状態**
- `stale`: 局面が変わった。旧結果は「以前の局面」と表示し、更新ボタンを出す。
- AI オフ・未同意: テンプレートのコーチングと確定事実だけを出す。
- AI の失敗: 理由の分類を示してテンプレートに戻る。
- 入力待ちでないとき（相手の番、自動解決中、終局）: Now は空になる。理由を表示し、Future は終局以外では表示する。

## 3. Now と Future

| グループ | 元データ | 載せる条件 |
|---|---|---|
| **Now（今できる行動）** | プレイヤーが今答えるべき入力（`player.getWaitingFor()` とその正規化 `CoachChoices`） | ゲームが今受け付ける入力だけ。種類ごとの意味は §4 |
| **Future（将来を見据えたプラン）** | `CoachAnalysisV1.candidates`（Phase 2、1〜3 枚） | すべての候補プラン。どれも「今すぐ実行できる一手」ではない |

**Future の可否（`eligibility`）**
- `legal-now`: 1 枚だけのプランで、そのカードがゲームの「Play project card」に含まれている場合だけ。
- `unknown`: 確認できないカードを含む場合。
- `conditional`: それ以外。2 枚以上のプランは、先頭が `legal-now` でも `conditional` とし、制約に「プラン全体は 1 手ではない」を付ける。

**注記**: 予測が未完成、探索の打ち切り、目的の偏りは、制約のコードとして表示する。

## 4. 入力の種類と対応（ゲームのコードで確認した意味）

| ゲームの入力 | 例 | 意味 | P3-CD-1 での扱い |
|---|---|---|---|
| `OrOptions` | 「Take your first action」、賞の資金提供 | 子の **どれか 1 つ** を選ぶ。入れ子は内側も 1 つ | 枝ごとに展開する。入れ子の枝は親の題名を添える |
| `SelectProjectCardToPlay`（`projectCard`） | 「Play project card」 | `player.getPlayableCards()`、つまり `canPlay`（条件と支払い可否）を通ったカードだけ。1 枚が 1 手（支払い方法は後で決める） | **project-card / legal-now / 検討可** |
| `SelectStandardProjectToPlay`（`projectCard`） | 「Standard projects」 | すべての標準プロジェクト。今できないものは `enabled=false`（`isDisabled`） | 実行可能なものは **standard-project / legal-now / 検討可**（定量分析なし）。不可のものは Now に載せず件数だけ示す |
| `SelectOption`（`option`） | 熱で温度、パス、ターン終了、賞の資金提供 | 1 つの決まった行動 | **game-option / legal-now / 検討可**（定量分析なし） |
| `UndoActionOption` | 「Undo last action」 | 直前の行動の取り消し | 表示はするが検討対象外（`undo`） |
| `SelectCard` + `selectBlueCardAction` | 「Perform an action from a played card」 | 青カードのアクションを 1 枚選ぶ。アクションの中身は後続の入力になる | 一覧に出すが検討対象外（`blue-action`、P3-CD-2 で対応） |
| `SelectCard`（その他） | 研究フェーズの購入（0〜4 枚）、Sell patents（1〜n 枚）、企業選択 | 複数選択、または購入（プレイではない） | 入力全体で 1 項目にまとめ、検討対象外（`card-selection`、P3-CD-2） |
| `AndOptions` / `SelectInitialCards` | ゲーム開始時の選択 | **全部** に答える複合入力 | 1 項目、検討対象外（`compound-input`） |
| `space` / `payment` / `player` / `amount` / `resource(s)` など | タイルの配置、支払い | 行動の途中で答える入力 | 1 項目、検討対象外（`input-not-analysed`） |

**作らない合法手**
- カード一覧の 1 枚ずつを独立した合法手としては作らない。例外は、上の表で「1 枚が 1 手」と確認したもの（Play project card、実行可能な標準プロジェクト）だけ。
- 複数選択と購入は、プレイと混同しない。
- 入力待ちでないとき（`waiting-for-others` / `resolving` / `game-over`）は、Now を空にする。

## 5. データ契約（P3-CD-1 で型とテストを確定）

既存の `CoachStateV1` と `CoachAnalysisV1` は変更しない。新しい版付きの契約を追加する。

### 5.1 `GET api/coach/options?id=<playerId>` → `CoachChoiceListV1`（`coach-choice-list/1`）

```ts
type CoachChoiceOption = {
  id: string;                       // サーバー生成の不透明 ID（局面トークン＋種類＋入力上の位置＋カード名のハッシュ）
  group: 'now' | 'future';
  kind: 'project-card' | 'standard-project' | 'game-option' | 'undo' | 'blue-action' |
        'card-selection' | 'compound-input' | 'input-not-analysed' | 'strategy-plan';
  label: {template: string, params: Array<{text: string, card?: boolean}>};  // ゲームの文言（クライアントで翻訳）
  parentLabel?: {...};              // 入れ子の or の親（例: 賞の資金提供）
  cardNames: string[];
  cost?: number;                    // ゲームが計算した費用（カード）
  planGoal?: PlanGoal;              // Future のみ
  eligibility: 'legal-now' | 'conditional' | 'unknown' | 'not-action';
  selectableForCoaching: boolean;
  limitations: string[];            // 理由コード（クライアントで翻訳）
};
type CoachChoiceListV1 = {
  schemaVersion: 'coach-choice-list/1';
  positionToken: string;
  analysisVersion: string;
  stateStatus: 'awaiting-input' | 'waiting-for-others' | 'resolving' | 'game-over';
  options: CoachChoiceOption[];
  omitted: Array<{reason: string, count: number}>;   // 例: 今はできない標準プロジェクト
  ai: {available: boolean};         // サーバー設定上 AI が使えるか（同意は別）
  warnings: string[];
};
```

**`positionToken`**
- 閲覧者、`stateKey`（内容の指紋、Undo の回数、ゲームの手数、ゲームの経過）、`advisoryFingerprint`、分析の版、契約の版から作る SHA-256（先頭 32 桁）。
- 秘密の ID は含まない。
- Undo で同じ内容に戻っても、`stateKey` が違うので別のトークンになる。

**選択肢の ID**: 同じ局面のあいだは安定している。サーバーは毎回一覧を作り直して照合し、ID からゲームの入力を作る経路は持たない。

### 5.2 `POST api/coach/counsel?id=<playerId>` → `CoachCounselV1`（`coach-counsel/1`）

リクエスト（`Content-Type: application/json`、2 KB まで）:

```json
{"schemaVersion": "coach-counsel-request/1", "positionToken": "…", "choiceId": "…",
 "compareWithChoiceId": null, "language": "jp", "aiConsent": false}
```

**サーバーの処理**
1. 本人の認可を確認する（既存の `CoachPlayerHandler`）。
2. 同一オリジンを確認する（`Sec-Fetch-Site`/`Origin`）。
3. JSON とフィールドの形、長さを検証する。
4. 同じプレイヤーの同時実行と、毎分の回数を制限する。
5. 最新の状態から一覧を作り直し、`positionToken` と `choiceId` を照合する。一致しなければ `409`（`status: 'stale'`）を返す。
6. 選択に関わる**事実カード**を作る。ID は `F1`…。値はゲームと分析だけから取る。
   - 費用
   - 支払いに使える資源
   - 可否
   - その選択を含むプランの関係
   - ブロッカー
   - 予測の差分
   - 未解析の効果
7. テンプレートでコーチングを作る（強み、注意点、見通し、問い 1 つ。各点に根拠 ID を付ける）。
8. AI の 3 条件（§6）が揃っていれば、モデルに事実カードと選択を渡す。返ってきた各主張の根拠 ID と数値を、その根拠の値で検証する。不合格ならテンプレートに戻る（`status: 'fallback'`）。
9. 返す直前に局面を再確認する。変わっていれば `status: 'stale'` とし、コーチングは返さない。

**レスポンス**

```ts
type CoachPoint = {
  text?: string;                                   // モデルの文（プレイヤーの言語）
  template?: {key: string, params: Array<{text: string, card?: boolean}>};  // テンプレート（クライアントで翻訳）
  evidenceIds: string[];                           // 事実カードの ID
  support: 'verified' | 'conditional' | 'unknown';
};
type CoachCounselV1 = {
  schemaVersion: 'coach-counsel/1';
  positionToken: string;
  selectedChoiceId: string;
  compareWithChoiceId?: string;
  status: 'ready' | 'fallback' | 'stale';
  source: 'template' | 'model';
  facts: Array<{id: string, kind: string, choiceId: string, value: unknown, support: 'verified' | 'conditional' | 'unknown'}>;
  strengths: CoachPoint[]; risks: CoachPoint[]; outlook: CoachPoint[]; question?: CoachPoint;
  limitations: string[];
  ai: {state: 'off' | 'no-consent' | 'used' | 'failed', category?: string, elapsedMs?: number};
};
```

## 6. AI の利用条件とセキュリティ

**外部 AI を使う条件（3 つすべて）**
1. サーバー設定 `COACH_AI_ENABLED=true` と `COACH_AI_EXTERNAL_ALLOWED=true`。既定はどちらも false。
2. プロバイダーのキーがあること（`OPENAI_API_KEY` など。サーバーの環境変数だけ）。
3. 利用者の明示的な同意（パネルのチェックボックス）。同意はこのブラウザにだけ保存し、リクエストごとに `aiConsent: true` で送る。

**モデル**
- 既定は `COACH_AI_MODEL=gpt-6.1-sol`（暫定、[ADR](adr-provider.md)）。
- 切り替えは `COACH_AI_PROVIDER=openai|sarashina` と `COACH_AI_MODEL`。

**モデルに渡すもの**
- 選択した行動の要約と、その事実カード。
- 比較先がある場合は、その事実カード。
- 局面の公開要約（世代、グローバルパラメータ、自分の資源と生産）。

**渡さないもの**
- プレイヤー、ゲーム、観戦者の ID。
- 選択肢 ID と局面トークン（短い別名に置き換える）。
- 人の名前。
- 相手の手札、山札。
- 履歴。

**ゲームを変えない**
- 経路はすべて読み取り専用。コーチから `PlayerInput` や `Game` を操作する手段はなく、モデルにツールも与えない。
- 試験で、`Game.serialize()` の結果がコーチ API の前後で変わらないことを確認する。

**負荷と表示の安全**
- 同じプレイヤーの同時実行は 1 件まで。
- 毎分の回数と、プロセス内のモデル呼び出し回数に上限を設ける（`COACH_AI_MAX_CALLS`）。
- `Cache-Control: no-store`。
- モデルの文は Vue のテキスト補間で表示する（HTML として解釈しない）。

**ログ**: ID、キー、モデルの文をログに出さない。失敗時は分類だけを出す。

## 7. モデルによる選択レビュー（P3-CD-1 は 1 モデルで縦切り）

- 指示は `coach-counsel-instructions/1`。
  - 選んだ行動について、強み・注意点・見通しをそれぞれ 0〜3 点、問いを 1 つ返す。
  - 各点は根拠の事実 ID を 1 つ以上持つ。
  - 根拠がない強みは書かない。
  - 迎合しない。
  - 最善、勝率、確実を言わない。
  - 予測が未完成のときは、合計を確定と言わない。
- 検証（主張と根拠の組）:
  - 根拠 ID は事実カードに存在すること。
  - 文中の数値は、その主張が参照する事実の値に含まれること。文脈のどこかにあるだけでは通さない。
  - 文中のカード名は、参照した事実か選択に含まれること。
  - 禁止表現と長さを確認する。
- 自由質問の部品（`contextBuilder`/`instructions`/`replyValidator`）は残す。選択レビューは別の指示と検証を持つ。

## 8. 試験の対応（計画 §8 の CD01〜CD28）

| P3-CD-1 で試験する | P3-CD-2 以降 |
|---|---|
| CD01–03, 05（購入を混同しないこと）, 08–12, 15–17, 19–22, 24, 25, 27 | CD04・06・07（入力の種類の拡張）、CD13・14（評価データで迎合を確かめる）、CD18（Undo の文脈、P3-CD-1 では局面トークンで区別するところまで）、CD23・28（実機）、CD26（分岐探索） |

## 9. 計画との差分

- **配置**: 計画 §5.1 の「縦はボトムシート、横はサイドパネル」は採らない。ゲームのアクションシート、ナビ、Undo を覆うことを Gate F の実機で確認したため、上部バーの直下に置く（[UX の決定](ux-decision.md)）。
- **入口**: P3-CD-1 はゲームメニュー（タブレットでは「Players」画面の ☰）から開く。1 タップの起動ボタンは、配置の実機確認とあわせて P3-CD-2 以降で入れる（計画が P3-CD-1 で許容している）。
- **選択肢の作り方**: 計画は `choices.ts`（正規化済みの `CoachChoices`）から作るとしている。入力の種類（標準プロジェクトとプロジェクトカード、Undo の区別）は正規化後の形では見分けられないため、`player.getWaitingFor()` の入力クラスで種類を判定する。費用などの値は `CoachChoices` から取る（両者は同じ添字で対応する）。
