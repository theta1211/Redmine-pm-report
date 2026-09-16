# 詳細設計書：Redmine連携 PM向け日次レポート（全体概要）

前提：`docs/requirements/requirements.md`の要件定義に基づく詳細設計。
本書は全体概要・データ設計・Redmine連携仕様・排他制御・非機能設計をまとめる。

| ドキュメント | 内容 |
|---|---|
| `architecture.md` | システム構成図・コンポーネント一覧・ディレクトリ構成 |
| `sequence.md` | シーケンス図（自動生成正常系／失敗時／手動再生成／エクスポート／保持期間クリーンアップ／多重起動防止） |
| `screen-spec.md` | 画面仕様（レポート一覧・レポート詳細・実行履歴の3画面） |
| `api-design.md` | API設計書 |

## 1. システム構成
技術スタックの概要は以下。詳細な構成図・コンポーネント一覧・ディレクトリ構成は`architecture.md`を参照。

| コンポーネント | 技術（提案） |
|---|---|
| Web閲覧アプリ | Node.js + TypeScript + Express、IIS + iisnodeでホストしIISのWindows認証機能を利用 |
| レポート生成バッチ | Node.js + TypeScript（CLIスクリプト、タスクスケジューラから起動） |
| レポート生成ロジック | `shared`パッケージとして実装し、バッチ・Web閲覧アプリ（手動再生成）の両方から呼び出す |
| データ管理 | DBは使用せずJSONファイルで管理（`reports/{対象日}.json` / `run-history.json`。詳細は2章） |
| Redmine連携 | Redmine REST API（axios、APIキー認証） |

手動再生成は、実装（AIエージェント呼び出し等）を含まずRedmine APIの取得・集計のみで完結するため、
Loop engineeringの実行エンジンのように別プロセスを起動する必要はない。
Web閲覧アプリから`shared`のレポート生成関数を直接（同一プロセス内で）呼び出し、同期的に結果を返す。
ただし自動バッチ（別プロセス）と同時に同一対象日を更新する可能性があるため、ファイルロックによる
排他制御は行う（4章）。

## 2. データ設計（JSONファイル、DB不使用）
利用規模（1日1レポート、参照者はPM数名程度）を踏まえ、DBは使わずJSONファイルで管理する。
書き込みは一時ファイルに書いてからrenameする方式でアトミック性を確保する。

### data/reports/{対象日 YYYY-MM-DD}.json（レポート本体）
```json
{
  "targetDate": "2026-09-14",
  "status": "success",
  "generatedAt": "2026-09-15T06:00:03+09:00",
  "summary": {
    "newCount": 5, "updatedCount": 8, "totalSpentHours": 32.0,
    "delayedCount": 2, "delayedUncalculableCount": 1
  },
  "newIssues": [ { "id": 1234, "subject": "...", "author": "佐藤", "tracker": "タスク",
    "priority": "通常", "assignee": "鈴木", "dueDate": "2026-09-20" } ],
  "updatedIssues": [ { "id": 1230, "subject": "...",
    "changes": [ { "field": "status", "from": "新規", "to": "進行中" } ] } ],
  "spentTime": [ { "assignee": "鈴木", "hours": 7.5 } ],
  "delayedIssues": [ { "id": 1201, "subject": "...", "assignee": "鈴木", "dueDate": "2026-09-10",
    "overdueDays": 4, "estimatedHours": 10.0, "doneRatio": 40, "delayHours": 6.0 } ],
  "delayedUncalculableIssues": [ { "id": 1190, "subject": "...", "assignee": "佐藤",
    "dueDate": "2026-09-05", "overdueDays": 9 } ],
  "errorMessage": null
}
```
`status=failed`の場合は`summary`以降のフィールドを持たず、`errorMessage`のみを設定する。

### data/run-history.json（バッチ実行履歴、配列を1ファイルで管理）
```json
{
  "items": [
    { "runId": "20260915-060003", "targetDate": "2026-09-14", "trigger": "scheduled",
      "triggeredBy": null, "startedAt": "2026-09-15T06:00:00+09:00",
      "finishedAt": "2026-09-15T06:00:03+09:00", "status": "success", "errorMessage": null }
  ]
}
```
`runId`は実行開始時刻（`yyyyMMdd-HHmmss`）を用いる。`trigger`は`scheduled` / `manual`。

### config/config.json（接続情報・環境依存値、.gitignore対象）
```json
{
  "redmine": { "url": "https://redmine.example.co.jp", "apiKey": "REPLACE_WITH_YOUR_REDMINE_API_KEY" },
  "project": { "identifier": "sample-project", "includeSubprojects": true },
  "trackers": ["タスク", "バグ"],
  "retentionDays": 90,
  "export": { "maxRangeDays": 31 },
  "dataDir": "./data"
}
```

## 3. 対象日・スケジュール設計
- タスクスケジューラのトリガーを「毎週月〜金曜日」に設定する（OS標準機能。休日を跨いだ翌営業日には
  自動的に前営業日分のレポートが生成される）。祝日は考慮しない。
- バッチは起動時刻の前日（JST 0:00〜23:59）を対象日として算出する。

## 4. 排他制御・多重起動防止
- 対象日ごとに`reports/{対象日}.json`への書き込み前後で`proper-lockfile`等によりロックを取得する。
- 自動バッチと手動再生成（Web閲覧アプリ）が同一対象日を同時に処理しようとした場合、後着手した側は
  ロック取得に失敗し、`GENERATION_IN_PROGRESS`（Web側）としてエラーを返す／終了する。
- `run-history.json`への追記もロックを取得したうえで読み込み→追記→書き込みを行う。

## 5. Redmine連携仕様

### 5.1 対象プロジェクト・トラッカーの絞り込み
- `config.project.identifier`で指定したプロジェクトを対象とする。
- `config.project.includeSubprojects=true`の場合、サブプロジェクトを含めて集計する。
  Redmine REST APIの`/issues.json`は`project_id`指定時に既定でサブプロジェクトを含むため、
  そのまま`project_id`のみで取得できるかどうかを実装時にRedmineのバージョンで確認し、
  含まれない場合は`GET /projects.json?parent_id={id}`で子プロジェクトを再帰的に取得したうえで
  複数プロジェクトの結果をマージする。
- `config.trackers`（トラッカー名の配列）は、`GET /trackers.json`で名前→IDのマッピングを取得し、
  `tracker_id=ID1,ID2`として絞り込む。

### 5.2 新規登録チケット
`GET /issues.json?project_id={id}&tracker_id={ids}&status_id=*&created_on={対象日}`
（`created_on`は`><対象日00:00:00|対象日23:59:59>`形式で範囲指定）

### 5.3 更新チケット（ステータス・担当者変更）
`GET /issues.json?project_id={id}&tracker_id={ids}&status_id=*&updated_on={対象日}&include=journals`
で対象日に更新のあったチケットを取得し、各チケットの`journals[].details[]`のうち
`property=attr` かつ `name=status_id` または `name=assigned_to_id` で、
`journals[].created_on`が対象日に含まれるものだけを変更点として採用する
（`updated_on`は他フィールドの変更でも更新されるため、実際に対象フィールドが変わった
journalのみを抽出する）。値（ID）は`GET /issue_statuses.json`・プロジェクトメンバー一覧で
名前に変換する。同一チケットに複数の対象journalがある場合は時系列順に連結して表示する。

### 5.4 作業時間集計
`GET /time_entries.json?project_id={id}&spent_on={対象日}`（サブプロジェクトを含める場合は
5.1と同様にプロジェクトIDを展開する）。担当者（`user`）ごとに`hours`を合計する。

### 5.5 遅延・期限超過チケットの判定（対象日時点の状態を再構成）
バッチの実行時刻は対象日の翌営業日であり、Redmine APIから取得できるのは「現在の状態」であるため、
対象日23:59時点の状態を以下の手順で再構成してから判定する。

1. 対象トラッカーの全チケット（`status_id=*`）を`include=journals`付きで取得する。
2. 各チケットについて、チケットの初期値（作成時のステータス・期日・進捗率・予定工数・担当者）を起点とし、
   `journals[].created_on`が対象日23:59以前のものだけを時系列順に適用して、対象日時点の値を復元する。
3. 復元した状態が「ステータスの`is_closed`が偽」かつ「期日が対象日より前」であるチケットを遅延チケットとする。
4. 遅延時間 = 予定工数（Estimated hours）×（1 − 進捗率（Done ratio）÷100）。
   予定工数が復元できない（未設定）場合は`delayedUncalculableIssues`に分類する。
5. 期日超過日数 = 対象日 − 期日（日数）。

※ Redmineのバージョンによっては予定工数・進捗率の変更がjournalの`details`に記録されない設定・運用が
あり得るため、実装時に対象Redmine環境で記録されることを確認する。記録されない場合は現在値を
代替値として使用する（誤差が生じうる旨を画面上に注記することを検討する）。

### 5.6 認証・接続
- `X-Redmine-API-Key`ヘッダでAPIキー認証を行う（`shared/src/redmineClient.ts`相当）。
- Redmine接続失敗・タイムアウトは自動リトライせず、要因が分かるメッセージのみを記録する
  （例：「Redmineへの接続に失敗しました」）。

## 6. 保持期間・クリーンアップ
- レポート（`reports/*.json`）・実行履歴（`run-history.json`の各エントリ）ともに、
  対象日が`config.retentionDays`（既定90日）より前になったものを削除対象とする。
- クリーンアップはレポート生成バッチの実行完了後、同一起動内で実行する（`sequence.md`6.）。
- 手動再生成で保持期間外の対象日を生成した場合も、次回のクリーンアップ処理で削除される
  （要件定義どおり、特別扱いはしない）。

## 7. Web閲覧アプリの認証
- 本番環境はIIS + iisnodeでホストし、IISのWindows統合認証を有効化・匿名認証を無効化する。
  IISが認証したアカウント名は`web.config`のURL RewriteルールによりX-Remote-Userヘッダーへ
  書き込む（Loop engineeringと同様の方式）。
- 非Windowsの開発・検証環境では、環境変数（例：`PMREPORT_DEV_USER`）でログインユーザー名を
  指定できる代替手段を用意する。

## 8. 未確定事項への決定・初期値（提案）
| 項目 | 決定内容 |
|---|---|
| Web閲覧アプリ・バッチの技術スタック | Node.js + TypeScript／Express／JSONファイル（DB不使用）／axios、IIS+iisnodeでホスト |
| 手動再生成の実行方式 | 別プロセスを起動せず、Web閲覧アプリから`shared`の生成ロジックを同期呼び出し |
| タスクスケジューラの起動スケジュール | 平日（月〜金）1日1回。時刻は導入環境で設定（例：6:00） |
| 保持期間の初期値 | 90日（`config.json`の`retentionDays`で変更可能） |
| 期間指定エクスポートの上限 | 31日 |
| 遅延時間の算出式 | 予定工数 ×（1 − 進捗率／100）。対象日時点の状態はjournalsから再構成 |
| ファイルロック | `proper-lockfile`等を使用し、`reports/{対象日}.json`単位・`run-history.json`単位でロック |
| 実行ログ（本仕組み自体のデバッグログ）の保存 | 当面は`run-history.json`の成功/失敗記録のみとし、詳細な技術ログは別途アプリケーションログ（ファイル出力等）に残すが画面には表示しない |

## 9. 非機能設計
- **排他制御**：`reports/{対象日}.json`・`run-history.json`の更新時にファイルロックを取得し、
  自動バッチとWeb閲覧アプリ（手動再生成）の同時書き込みによる不整合を防止する。
- **異常系**：Redmine接続失敗・タイムアウトはレポートを`status=failed`として保存し、
  自動リトライは行わない。次回のスケジュール起動には影響を与えない。
- **セキュリティ**：Redmine APIキーは`config/config.json`（.gitignore対象）で管理し、
  リポジトリにコミットしない。Web画面はLAN内にHTTPで公開し、Windows統合認証でアクセス制御する
  （HTTPS化は行わない）。
- **保持期間管理**：レポート・実行履歴とも対象日基準で90日（設定可能）を超えたものを自動削除する。
- **タイムゾーン**：JST固定。

## 10. 実装マイルストーン（案）
1. `shared`：Redmine連携（issues／journals／time_entries取得）・状態再構成・集計ロジックの実装
2. `shared`：レポートJSON⇔Markdown変換ロジックの実装
3. `batch`：対象日算出・レポート生成・保持期間クリーンアップ・実行履歴記録・排他制御
4. `webapp`：レポート一覧／詳細／実行履歴のAPI・画面（`api-design.md`・`screen-spec.md`準拠）
5. `webapp`：手動再生成・単日／期間指定Markdownエクスポート
6. IIS + Windows認証の統合、Windowsタスクスケジューラへの登録手順のドキュメント化
7. 実データでの動作確認（遅延判定の再構成ロジックを中心に、Redmine実環境での検証）
