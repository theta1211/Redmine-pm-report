# Redmine連携 PM向け日次レポート

Redmineの指定プロジェクト（サブプロジェクト含む）の日々の活動履歴（チケット新規登録・
ステータス／担当者の変更、作業時間、遅延・期限超過チケット）を集計し、PM向けの日次レポートを
自動生成する仕組み。構成・設計方針は
[Lychee-redmine-loop-engineering-](https://github.com/theta1211/Lychee-redmine-loop-engineering-)
を参考にしている。

- 要件定義: [`docs/requirements/requirements.md`](docs/requirements/requirements.md)
- システム構成図: [`docs/design/architecture.md`](docs/design/architecture.md)
- シーケンス図: [`docs/design/sequence.md`](docs/design/sequence.md)
- 画面仕様: [`docs/design/screen-spec.md`](docs/design/screen-spec.md)
- API設計書: [`docs/design/api-design.md`](docs/design/api-design.md)
- 詳細設計（データ設計・Redmine連携仕様・非機能設計）: [`docs/design/detailed-design.md`](docs/design/detailed-design.md)

## 現在のステータス

要件定義・詳細設計が完了。実装はこれから。

## リポジトリ構成

```
shared/    共有ロジック（Redmine連携・状態再構成・集計・Markdown変換・JSONファイルの読み書き）
webapp/    Web閲覧アプリ（レポート一覧・詳細・実行履歴表示、手動再生成、Markdownエクスポート、Express）
batch/     レポート生成バッチ（タスクスケジューラから起動するCLI）
config/    設定ファイルの雛形（実際のconfig.jsonは.gitignore対象）
data/      生成済みレポート・実行履歴（.gitignore対象）
docs/      要件定義・詳細設計ドキュメント
```

Loop engineeringと同様、DBは使用せずJSONファイルで状態・レポートデータを管理する方針。

## 概要（確定した主な仕様）

- 対象プロジェクトは1件（サブプロジェクト含めて合算）に固定。集計対象トラッカーは設定ファイルで指定。
- Windowsタスクスケジューラを平日（月〜金）のみ稼働させ、対象日は常に前日（JST基準）。
- レポート内容：新規登録チケット、ステータス／担当者の変更、作業時間集計（担当者別）、
  遅延・期限超過チケット（遅延時間 = 予定工数 ×（1 − 進捗率））。
- Web画面でレポート一覧・詳細・実行履歴を閲覧し、単日または期間（最大31日）指定でMarkdownエクスポート。
- ログインしたPMは誰でも任意日の手動再生成が可能（欠測・失敗時のリカバリ用）。
- レポート・実行履歴の保持期間は既定90日（対象日基準、設定変更可）。
- Windows統合認証（IIS＋iisnode）でアクセス制御。認証情報は`config/config.json`（.gitignore対象）で管理。

詳細は上記の各ドキュメントを参照。
