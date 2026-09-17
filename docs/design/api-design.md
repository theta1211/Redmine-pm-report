# API設計書

Web閲覧アプリが提供する内部API。すべてIISのWindows統合認証配下で提供され、
未認証アクセスはIISが401を返すため、アプリ側での認証実装は不要
（IISが付与するX-Remote-Userヘッダーの取り扱いは`detailed-design.md` 7章を参照）。
データはDB不使用で`data/reports/{対象日}.json` / `data/run-history.json`を直接読み書きする
（読み書き時はファイルロックを取得する。詳細は`detailed-design.md`参照）。

共通仕様：
- Content-Type: `application/json`（Markdownエクスポート系のレスポンスのみ`text/markdown`）
- エラー時のレスポンス形式：`{ "error": { "code": "STRING", "message": "人が読めるメッセージ" } }`
- 日時はISO 8601（例：`2026-09-15T06:00:03+09:00`）、対象日は`YYYY-MM-DD`

## 1. GET /api/reports
保存されているレポートの一覧を対象日降順で取得する。
保持期間クリーンアップが未実行の時点で保持期間外のレポート（手動再生成で作成したもの等）が
存在する場合、それも含めて返す（画面上は保存されているものがそのまま見える）。

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
        "delayedCount": 3,
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
`delayedCount`は遅延チケットの総数、`delayedUncalculableCount`はそのうち計算不可（工数未設定）の
件数（内数）。

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
    "delayedCount": 3, "delayedUncalculableCount": 1
  },
  "newIssues": [
    { "id": 1234, "subject": "○○機能の追加", "author": "佐藤", "tracker": "タスク",
      "priority": "通常", "assignee": "鈴木", "dueDate": "2026-09-20" }
  ],
  "updatedIssues": [
    { "id": 1230, "subject": "△△バグ修正",
      "changes": [ { "field": "status", "from": "新規", "to": "進行中" } ] }
  ],
  "spentTime": [ { "user": "鈴木", "hours": 7.5 }, { "user": "佐藤", "hours": 4.0 } ],
  "delayedIssues": [
    { "id": 1201, "subject": "□□対応", "assignee": "鈴木", "dueDate": "2026-09-10",
      "overdueDays": 4, "estimatedHours": 10.0, "doneRatio": 40, "delayHours": 6.0 },
    { "id": 1198, "subject": "××改善", "assignee": "未アサイン", "dueDate": "2026-09-08",
      "overdueDays": 6, "estimatedHours": 4.0, "doneRatio": 20, "delayHours": 3.2 }
  ],
  "delayedUncalculableIssues": [
    { "id": 1190, "subject": "△改修", "assignee": "佐藤", "dueDate": "2026-09-05", "overdueDays": 9 }
  ]
}
```
`spentTime[].user`は作業時間を入力した利用者（Redmineの`time_entry.user`）であり、
チケットの担当者とは別物である。

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

**エラー**
| code | 条件 | HTTPステータス |
|---|---|---|
| REPORT_NOT_FOUND | 指定日のレポートが存在しない | 404 |
| REPORT_FAILED | `status=failed`のレポートはエクスポートできない | 409 |

## 4. GET /api/reports/export
開始日・終了日をクエリで指定し、期間内の複数日分をまとめたMarkdownファイルをダウンロードする
（ブラウザから直接リンク・フォーム送信でダウンロードできるようGETとする）。

**クエリパラメータ**
| 名前 | 必須 | 説明 |
|---|---|---|
| from | 必須 | 期間の開始日（`YYYY-MM-DD`） |
| to | 必須 | 期間の終了日（`YYYY-MM-DD`） |

例：`GET /api/reports/export?from=2026-09-01&to=2026-09-14`

**レスポンス 200**：`Content-Type: text/markdown`、
`Content-Disposition: attachment; filename="report_2026-09-01_2026-09-14.md"`

ファイルの構成：
1. 期間全体のサマリ（期間の合計作業時間、新規登録件数の合計、更新件数の合計（延べ件数：同一チケットが
   複数日更新された場合は日ごとに計上）、期間内で最も新しい対象日のレポート時点の遅延件数）
2. 日ごとの詳細（対象日の昇順）
3. レポートが存在しない日（未生成・生成失敗・保持期間切れ）の一覧

**エラー**
| code | 条件 | HTTPステータス |
|---|---|---|
| INVALID_RANGE | `from`が`to`より後、日付形式が不正、または期間が31日を超過 | 400 |
| NO_REPORTS_IN_RANGE | 期間内に成功レポートが1件も存在しない | 404 |

## 5. POST /api/reports/:date/regenerate
指定した対象日のレポートを手動で再生成する。ログインしたPMは誰でも実行できる。
処理はレポート生成ロジックを同期的に呼び出し、完了後に結果を返す
（Redmine APIの応答時間に依存するため、クライアント側は数秒〜数十秒のレスポンス待ちを想定する）。

Redmineへの接続に失敗した場合はエラーレスポンスではなく、`status=failed`のレポートを保存したうえで
200でそのレポートを返す（自動バッチでの失敗時と同じ扱いにするため）。

**レスポンス 200**：再生成後のレポート（2.と同形式。失敗時は`status=failed`のレポート）

**エラー**
| code | 条件 | HTTPステータス |
|---|---|---|
| INVALID_DATE | `:date`が`YYYY-MM-DD`形式でない、または未来日 | 400 |
| GENERATION_IN_PROGRESS | 同一対象日に対して他の生成処理（自動バッチ含む）が実行中 | 409 |

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

## 8. GET /api/app-info
画面ヘッダーの表示や入力チェックに使う設定値を返す。
`config.json`のうち機微情報（Redmine URL・APIキー）は含めない。

**レスポンス 200**
```json
{
  "project": { "identifier": "sample-project", "includeSubprojects": true },
  "trackers": ["タスク", "バグ"],
  "retentionDays": 90,
  "maxRangeDays": 31,
  "today": "2026-09-16"
}
```
