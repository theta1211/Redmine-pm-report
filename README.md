# Redmine連携 PM向け日次レポート

Redmineの指定プロジェクト（サブプロジェクト含む）の日々の活動履歴（チケット新規登録・
ステータス／担当者の変更、作業時間、遅延・期限超過チケット）を集計し、PM向けの日次レポートを
自動生成する仕組み。構成・設計方針は
[Lychee-redmine-loop-engineering-](https://github.com/theta1211/Lychee-redmine-loop-engineering-)
を参考にしている。

- 要件定義: [`docs/requirements/requirements.md`](docs/requirements/requirements.md)
- システム構成図: [`docs/design/architecture.md`](docs/design/architecture.md)
- シーケンス図: [`docs/design/sequence.md`](docs/design/sequence.md)
- 画面仕様: [`docs/design/screen-spec.md`](docs/design/screen-spec.md)（[HTMLモック](docs/design/screen-mockup.html)あり）
- API設計書: [`docs/design/api-design.md`](docs/design/api-design.md)
- 詳細設計（データ設計・Redmine連携仕様・非機能設計）: [`docs/design/detailed-design.md`](docs/design/detailed-design.md)

## 現在のステータス

要件定義・詳細設計・画面モックが完了。実装はこれから。

## リポジトリ構成

```
shared/    共有ロジック（Redmine連携・状態復元・集計・Markdown変換・JSONファイルの読み書き）
webapp/    Web閲覧アプリ（レポート一覧・詳細・実行履歴表示、手動再生成、Markdownエクスポート、Express）
batch/     レポート生成バッチ（タスクスケジューラから起動するCLI）
config/    設定ファイルの雛形（実際のconfig.jsonは.gitignore対象）
data/      生成済みレポート・実行履歴（.gitignore対象）
docs/      要件定義・詳細設計ドキュメント
```

Loop engineeringと同様、DBは使用せずJSONファイルで状態・レポートデータを管理する方針。

## 概要（確定した主な仕様）

- 対象プロジェクトは1件（サブプロジェクト含めて合算）に固定。集計対象トラッカーは設定ファイルで指定。
- Windowsタスクスケジューラを平日（月〜金）のみ稼働させ、対象日は起動日の**直前の営業日**
  （月曜日の実行では前週金曜日分。祝日は考慮しない）。
- レポート内容：新規登録チケット、ステータス／担当者の変更、作業時間集計（入力者別）、
  遅延・期限超過チケット（遅延時間 = 予定工数 ×（1 − 進捗率））。
  遅延判定は対象日時点の状態をRedmineのjournalsから復元して行う。
- Web画面でレポート一覧・詳細・実行履歴を閲覧し、単日または期間（最大31日）指定でMarkdownエクスポート。
- ログインしたPMは誰でも任意日の手動再生成が可能（欠測・失敗時のリカバリ用）。
- レポート・実行履歴の保持期間は既定90日（対象日基準、設定変更可）。
- Windows統合認証（IIS＋iisnode）でアクセス制御。認証情報は`config/config.json`（.gitignore対象）で管理。

詳細は上記の各ドキュメントを参照。

## セットアップ（実装後の想定）

```bash
npm install
npm run build
cp config/config.example.json config/config.json
# config/config.json を環境に合わせて編集する（Redmine URL/APIキー、対象プロジェクト、トラッカー等）
```

### config.json の項目

| 項目 | 説明 |
|---|---|
| `redmine.url` / `redmine.apiKey` | 既存Redmineサーバーの接続情報（参照のみのため閲覧権限のAPIキーを推奨） |
| `project.identifier` | レポート対象のRedmineプロジェクト識別子（1つに固定） |
| `project.includeSubprojects` | サブプロジェクトを集計に含めるか |
| `trackers` | 集計対象トラッカー名の配列（例：`["タスク", "バグ"]`） |
| `retentionDays` | レポート・実行履歴の保持日数（対象日基準、既定90） |
| `export.maxRangeDays` | 期間指定エクスポートの上限日数（既定31） |
| `dataDir` | レポート・実行履歴を置くディレクトリ（既定は`./data`） |
