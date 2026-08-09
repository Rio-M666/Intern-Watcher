# 魔法のスプレッドシート Intern Watcher

公開されている「魔法のスプレッドシート2026」のインターン情報を毎日取得し、前回との差分をGitHub上のJSONとして公開するためのスクレイパーです。OpenAI API、ログイン、CAPTCHA回避、stealth pluginは使用しません。

Notion URLは固定せず、実行のたびに[公式サイト](https://magic-spreadsheets.github.io/)から「2026」と書かれた公開Notionリンクを発見します。その後、公開データベースの「インターン」ビューをPlaywright Chromiumで開き、virtualized renderingを考慮してスクロールしながら行を収集します。browser contextは`Asia/Tokyo`タイムゾーンで動作するため、UTCのGitHub Actions上でもNotionの日付時刻を日本時間として取得します。

## セットアップ

Node.js 22以上が必要です。

```bash
npm install
npx playwright install chromium
```

UbuntuでChromiumのシステム依存関係も導入する場合は、次のコマンドを使います。

```bash
npx playwright install chromium --with-deps
```

## ローカル実行

```bash
npm run scrape
npm run typecheck
npm test
```

`npm run scrape`は成功時だけ`data/current.json`と`data/feed.json`を原子的に置き換えます。前回20件以上のときに今回件数が前回の60%未満になった場合や、0件になった場合は異常終了し、既存の正常な2ファイルを維持します。`MAX_SCROLLS`環境変数で最大スクロール回数を変更できます（既定160、上限500）。

## GitHub Actions

`.github/workflows/scrape.yml`は以下に対応しています。

- `workflow_dispatch`からの手動実行
- 毎日07:17 Asia/Tokyo（cronは前日22:17 UTC）
- `ubuntu-latest`、Node.js 22、Chromium
- スクレイピング前に型チェックと単体テストを実行
- 成功時に`data/`の変更を`GITHUB_TOKEN`でcommit / push
- 失敗時に`debug/`と`data/status.json`をActions artifactとして7日間保存
- 30分のジョブタイムアウトと重複実行防止

リポジトリやブランチの保護設定によってActionsから直接pushできない場合は、対象ブランチへのGitHub Actionsのpushを許可するか、PR作成型の運用へ変更してください。

## JSON schema

### `data/current.json`

現在取得できる全求人です。

```json
{
  "generatedAt": "2026-08-09T00:00:00.000Z",
  "sourceUrl": "https://example.notion.site/database?v=view",
  "jobs": [
    {
      "id": "sha256...",
      "contentHash": "sha256...",
      "company": "Example株式会社",
      "title": "開発インターン",
      "status": "募集中",
      "deadline": "2026/08/31",
      "category": "インターン",
      "eligibility": "大学生・大学院生",
      "detailUrl": "https://example.com/jobs/1",
      "sourceUrl": "https://example.notion.site/database?v=view",
      "firstSeenAt": "2026-08-09T00:00:00.000Z",
      "lastSeenAt": "2026-08-09T00:00:00.000Z"
    }
  ]
}
```

`detailUrl`があればtracking parameterとfragmentを除いたcanonical URLのSHA-256を`id`にします。なければ正規化した`company`、`title`、`deadline`を使います。`contentHash`は求人内容だけから計算し、`generatedAt`、`firstSeenAt`、`lastSeenAt`は含めません。

JSONに保存する`company`、`title`、`eligibility`などの表示値は維持しつつ、`contentHash`の計算時だけ絵文字、variation selector、zero-width文字などの不可視制御文字を除去し、改行と連続空白を単一の空白へ揃えます。このため表示上意味のない揺れでは`updated`にならず、タイトル、締切、募集要件などの実質的な変更は引き続き検出されます。

### `data/feed.json`

`new`または`updated`になったイベントを実行日だけで上書きせず、直近14日分保持します。同じIDで`contentHash`が変わった場合、`changedFields`に変化したフィールド名が入ります。

```json
{
  "generatedAt": "2026-08-09T00:00:00.000Z",
  "retentionDays": 14,
  "items": [
    {
      "id": "sha256...",
      "changeType": "updated",
      "firstSeenAt": "2026-08-01T00:00:00.000Z",
      "updatedAt": "2026-08-09T00:00:00.000Z",
      "changedFields": ["deadline"],
      "company": "Example株式会社",
      "title": "開発インターン",
      "deadline": "2026/09/01",
      "detailUrl": "https://example.com/jobs/1"
    }
  ]
}
```

### `data/status.json`

直近実行の`generatedAt`、`success`、`sourceCount`、`newCount`、`updatedCount`、`scraperVersion`、発見した`sourceUrl`、失敗理由`error`を保存します。

## カラム名の変更

Notion側のカラム表記と出力フィールドの対応は`src/normalize.ts`の`COLUMN_ALIASES`へ集約しています。たとえば「企業名」が「会社名」に変わった場合は、そのalias配列を追加・変更します。`募集要件`と`対象者`のように複数カラムが同じフィールドへ対応する場合は改行で結合します。

## 壊れた場合のデバッグ

失敗時は可能な限り次を生成します。

- `debug/screenshot.png`: 失敗時点の画面
- `debug/page.html`: 失敗時点のDOM
- `debug/error.txt`: エラー内容
- `data/status.json`: 実行時刻と失敗理由（Actions artifactにも含まれます）

Actionsでは失敗したrunのArtifactsから取得できます。ローカルでは`debug/page.html`でヘッダー名と`.notion-table-view-*`要素を確認し、次の順で調査してください。

1. 公式サイトの2026リンク表示やNotion URL形式が変わっていないか確認する。
2. Notionに「インターン」タブとヘッダー行が表示されているか確認する。
3. `COLUMN_ALIASES`へ変更後のカラム名を追加する。
4. Notionの行・セル構造が変わった場合は`src/scrape.ts`の意味付きselectorを更新する。
5. CloudflareやCAPTCHAの確認画面なら回避を実装せず、時間を空けて通常アクセスが戻るのを待つ。

通常運用は公開ページへの1日1回のアクセスを想定しています。短時間に何度も実行すると、公開元の保護機構により一時的に確認画面が表示される可能性があります。
