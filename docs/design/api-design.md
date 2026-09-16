# API設計書

Web閲覧アプリが提供する内部API。すべてIISのWindows統合認証配下で提供され、
未認証アクセスはIISが401を返すため、アプリ側での認証実装は不要。
データはDB不使用で`data/reports/{対象日}.json` / `data/run-history.json`を直接読み書きする
（読み書き時はファイルロックを取得する。詳細は`detailed-design.md`参照）。

共通仕様：
- Content-Type: `application/json`（Markdownエクスポート系のレスポンスのみ`text/markdown`）
- エラー時のレスポンス形式：`{ "error": { "code": "STRING", "message": "人が読めるメッセージ" } }`
- 日時はISO 8601（例：`2026-09-15T06:00:03+09:00`）、対象日は`YYYY-MM-DD`

## 1. GET /api/reports
生成済みレポートの一覧を取得する（保持期間内のもののみ、対象日降順）。

**レスポンス 200**
```json
{
  "items": [
    {
      "targetDate": "2026-09-14",
      "status": "success",
      "generatedAt": "2026-09-15T06:00:03+09:00",
      "summary": {
        "newCount": 5,
        "updatedCount": 8,
        "totalSpentHours": 32.0,
        "delayedCount": 2,
        "delayedUncalculableCount": 1
      }
    },
    {
      "targetDate": "2026-09-11",
      "status": "failed",
      "generatedAt": "2026-09-12T06:00:04+09:00",
      "errorMessage": "Redmineへの接続に失敗しました"
    }
  ]
}
```

## 2. GET /api/reports/:date
指定した対象日のレポート詳細を取得する（`:date`は`YYYY-MM-DD`）。

**レスポンス 200**（`status=success`の場合）
```json
{
  "targetDate": "2026-09-14",
  "status": "success",
  "generatedAt": "2026-09-15T06:00:03+09:00",
  "summary": {
    "newCount": 5, "updatedCount": 8, "totalSpentHours": 32.0,
    "delayedCount": 2, "delayedUncalculableCount": 1
  },
  "newIssues": [
    { "id": 1234, "subject": "○○機能の追加", "author": "佐藤", "tracker": "タスク",
      "priority": "通常", "assignee": "鈴木", "dueDate": "2026-09-20" }
  ],
  "updatedIssues": [
    { "id": 1230, "subject": "△△バグ修正",
      "changes": [ { "field": "status", "from": "新規", "to": "進行中" } ] }
  ],
  "spentTime": [ { "assignee": "鈴木", "hours": 7.5 }, { "assignee": "佐藤", "hours": 4.0 } ],
  "delayedIssues": [
    { "id": 1201, "subject": "□□対応", "assignee": "鈴木", "dueDate": "2026-09-10",
      "overdueDays": 4, "estimatedHours": 10.0, "doneRatio": 40, "delayHours": 6.0 }
  ],
  "delayedUncalculableIssues": [
    { "id": 1190, "subject": "△改修", "assignee": "佐藤", "dueDate": "2026-09-05", "overdueDays": 9 }
  ]
}
```

**レスポンス 200**（`status=failed`の場合）
```json
{ "targetDate": "2026-09-11", "status": "failed", "generatedAt": "2026-09-12T06:00:04+09:00",
  "errorMessage": "Redmineへの接続に失敗しました" }
```

**エラー**
| code | 条件 | HTTPステータス |
|---|---|---|
| REPORT_NOT_FOUND | 指定日のレポートが存在しない（未生成または保持期間切れ） | 404 |

## 3. GET /api/reports/:date/export
指定した対象日のレポートをMarkdownファイルとしてダウンロードする。

**レスポンス 200**：`Content-Type: text/markdown`、
`Content-Disposition: attachment; filename="report_2026-09-14.md"`

**エラー**：`REPORT_NOT_FOUND`（2.と同様）、`REPORT_FAILED`（`status=failed`のレポートはエクスポート不可、409）

## 4. POST /api/reports/export
開始日・終了日を指定し、期間内の複数日分をまとめたMarkdownファイルをダウンロードする。

**リクエスト**
```json
{ "from": "2026-09-01", "to": "2026-09-14" }
```

**レスポンス 200**：`Content-Type: text/markdown`、
`Content-Disposition: attachment; filename="report_2026-09-01_2026-09-14.md"`
冒頭に期間全体のサマリ、続けて存在する日ごとの詳細を記載する。

**エラー**
| code | 条件 | HTTPステータス |
|---|---|---|
| INVALID_RANGE | `from`が`to`より後、または期間が31日を超過 | 400 |
| NO_REPORTS_IN_RANGE | 期間内に成功レポートが1件も存在しない | 404 |

## 5. POST /api/reports/:date/regenerate
指定した対象日のレポートを手動で再生成する。ログインしたPMは誰でも実行できる。
処理はレポート生成ロジックを同期的に呼び出し、完了後に結果を返す
（Redmine APIの応答時間に依存するため、クライアント側は数秒〜数十秒のレスポンス待ちを想定する）。

**レスポンス 200**：再生成後のレポート（2.と同形式）

**エラー**
| code | 条件 | HTTPステータス |
|---|---|---|
| INVALID_DATE | `:date`が`YYYY-MM-DD`形式でない、または未来日 | 400 |
| GENERATION_IN_PROGRESS | 同一対象日に対して他の生成処理（自動バッチ含む）が実行中 | 409 |
| REDMINE_UNAVAILABLE | Redmineへの接続に失敗した場合（結果は`status=failed`として保存したうえで返す） | 200 |

## 6. GET /api/run-history
バッチの実行履歴を取得する（保持期間内のもの、実行日時降順）。

**レスポンス 200**
```json
{
  "items": [
    { "runId": "20260915-060003", "targetDate": "2026-09-14", "trigger": "scheduled",
      "triggeredBy": null, "startedAt": "2026-09-15T06:00:00+09:00",
      "finishedAt": "2026-09-15T06:00:03+09:00", "status": "success", "errorMessage": null },
    { "runId": "20260914-101240", "targetDate": "2026-09-13", "trigger": "manual",
      "triggeredBy": "DOMAIN\\sato", "startedAt": "2026-09-14T10:12:38+09:00",
      "finishedAt": "2026-09-14T10:12:40+09:00", "status": "success", "errorMessage": null }
  ]
}
```

## 7. GET /api/whoami
Windows認証で識別された現在のログインユーザー名を返す（デバッグ・画面表示用）。

**レスポンス 200**
```json
{ "user": "DOMAIN\\sato" }
```
