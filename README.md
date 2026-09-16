# Redmine連携 PM向け日次レポート

Redmineの指定プロジェクトの日々の活動履歴（チケット新規登録・更新・ステータス変更、作業時間、
遅延・期限超過チケット）を集計し、PM向けの日次レポートを自動生成する仕組み。
構成・設計方針は
[Lychee-redmine-loop-engineering-](https://github.com/theta1211/Lychee-redmine-loop-engineering-)
を参考にしている。

- 要件定義: [`docs/requirements/requirements.md`](docs/requirements/requirements.md)

## 現在のステータス

要件定義のみ完了。詳細設計・実装はこれから。

## 想定リポジトリ構成（設計時に確定）

```
shared/    共有ロジック（Redmine連携・JSONファイルの読み書き・レポート集計ロジック）
webapp/    Web閲覧アプリ（レポート一覧・詳細表示・Markdownエクスポート、Express）
batch/     レポート生成バッチ（タスクスケジューラから起動するCLI）
config/    設定ファイルの雛形（実際のconfig.jsonは.gitignore対象）
data/      生成済みレポート（.gitignore対象）
docs/      要件定義・詳細設計ドキュメント
```

Loop engineeringと同様、DBは使用せずJSONファイルで状態・レポートデータを管理する方針。
