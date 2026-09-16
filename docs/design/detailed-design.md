# 詳細設計書：Redmine連携 PM向け日次レポート（全体概要）

前提：`docs/requirements/requirements.md`の要件定義に基づく詳細設計。
本書は全体概要・データ設計・Redmine連携仕様・排他制御・非機能設計をまとめる。

| ドキュメント | 内容 |
|---|---|
| `architecture.md` | システム構成図・コンポーネント一覧・ディレクトリ構成 |
| `sequence.md` | シーケンス図（自動生成正常系／失敗時／手動再生成／エクスポート／保持期間クリーンアップ／多重起動防止） |
| `screen-spec.md` | 画面仕様（レポート一覧・レポート詳細・実行履歴の3画面。HTMLモック`screen-mockup.html`あり） |
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
ただし以下2点に留意する。

- 自動バッチ（別プロセス）と同時に同一対象日を更新する可能性があるため、ファイルロックによる
  排他制御を行う（4章）。
- 生成処理は複数回のRedmine API呼び出しを伴うため、IIS/iisnodeのリクエストタイムアウト
  （既定120秒）を超えないことを導入時に確認する（API呼び出し回数の見積もりは5.6を参照）。
  超える場合は`iisnode`の`requestTimeout`を延長する。

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
    "delayedCount": 3, "delayedUncalculableCount": 1
  },
  "newIssues": [ { "id": 1234, "subject": "...", "author": "佐藤", "tracker": "タスク",
    "priority": "通常", "assignee": "鈴木", "dueDate": "2026-09-20" } ],
  "updatedIssues": [ { "id": 1230, "subject": "...",
    "changes": [ { "field": "status", "from": "新規", "to": "進行中" } ] } ],
  "spentTime": [ { "user": "鈴木", "hours": 7.5 } ],
  "delayedIssues": [ { "id": 1201, "subject": "...", "assignee": "鈴木", "dueDate": "2026-09-10",
    "overdueDays": 4, "estimatedHours": 10.0, "doneRatio": 40, "delayHours": 6.0 } ],
  "delayedUncalculableIssues": [ { "id": 1190, "subject": "...", "assignee": "佐藤",
    "dueDate": "2026-09-05", "overdueDays": 9 } ],
  "errorMessage": null
}
```
- `status=failed`の場合は`summary`以降のフィールドを持たず、`errorMessage`のみを設定する。
- `summary.delayedCount`は遅延チケットの**総数**（計算可能分＋計算不可分）、
  `summary.delayedUncalculableCount`はそのうち計算不可の件数（内数）とする。
  上記例では `delayedIssues`（計算可能）2件 ＋ `delayedUncalculableIssues` 1件 ＝ `delayedCount` 3件。
- `spentTime[].user`は作業時間を入力した利用者（Redmineの`time_entry.user`）であり、
  チケットの担当者（`assigned_to`）とは別物である点に注意する。

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
- タスクスケジューラのトリガーを「毎週月〜金曜日」に設定する（土日はバッチを起動しない）。
- 対象日は「起動日の**直前の営業日**（月〜金）」とする。起動日から1日ずつ遡り、最初に見つかった
  月〜金の日付を採用する（火〜金曜の起動は1日前、月曜日の起動は3日前＝前週金曜日）。祝日は考慮しない。
  単純な「前日」では月曜日の対象日が日曜日になってしまうため、必ず営業日判定を伴う算出を行う。
- 帰結として、土日に行われた活動はレポートの対象にならない。また連休明けの起動では
  「直前の平日＝祝日」が対象日となり活動なしのレポートになるため、連休前営業日分は
  手動再生成（`api-design.md` 5.）で補完する運用とする。

## 4. 排他制御・多重起動防止
- 対象日ごとに`reports/{対象日}.json`への書き込み前後で`proper-lockfile`等によりロックを取得する。
  ロック取得の待機は数秒でタイムアウトさせ、長時間ブロックしない。
- 自動バッチと手動再生成（Web閲覧アプリ）が同一対象日を同時に処理しようとした場合、後着手した側は
  ロック取得に失敗し、`GENERATION_IN_PROGRESS`（Web側）としてエラーを返す／終了する。
- `run-history.json`への追記もロックを取得したうえで読み込み→追記→書き込みを行う。

## 5. Redmine連携仕様

### 5.1 共通事項（ページネーション・タイムゾーン）
**ページネーション**：Redmine REST APIの一覧系エンドポイントは既定25件・最大100件しか返さない。
`limit=100`と`offset`を用い、レスポンスの`total_count`に達するまでループして全件を取得する
（単発リクエストで済ませるとチケット数が100件を超えるプロジェクトで取りこぼす）。

**タイムゾーン**：`created_on` / `updated_on`はタイムスタンプで、Redmineの設定タイムゾーンで
返却・解釈される。一方`spent_on`（作業日）は日付のみを持つ。本仕組みはJST固定で動作するため、
対象日の範囲は「JSTの0:00〜23:59」を明示して指定する
（例：`created_on=><2026-09-14T00:00:00+09:00|2026-09-14T23:59:59+09:00>`）。
実装時に対象Redmineのタイムゾーン設定を確認し、日付境界がずれないことをテストで検証する。

### 5.2 対象プロジェクト・トラッカーの絞り込み
- `config.project.identifier`で指定したプロジェクトを対象とする。
- `config.project.includeSubprojects=true`の場合、サブプロジェクトを含めて集計する。
  Redmine REST APIの`/issues.json`は`project_id`指定時に既定でサブプロジェクトを含むため、
  そのまま`project_id`のみで取得できるかどうかを実装時にRedmineのバージョンで確認し、
  含まれない場合は`GET /projects.json?parent_id={id}`で子プロジェクトを再帰的に取得したうえで
  複数プロジェクトの結果をマージする。
- `config.trackers`（トラッカー名の配列）は、`GET /trackers.json`で名前→IDのマッピングを取得し、
  `tracker_id=ID1,ID2`として絞り込む。

### 5.3 新規登録チケット
`GET /issues.json?project_id={id}&tracker_id={ids}&status_id=*&created_on=><{対象日00:00:00}|{対象日23:59:59}>`

表示する担当者・期日はAPIが返す**現在値**である（対象日以降に変更された場合は変更後の値が載る）。
登録時点の値が必要になった場合は5.6と同様の巻き戻しが必要になるため、当面は現在値で運用する。

### 5.4 更新チケット（ステータス・担当者変更）
Redmine REST APIでは、**journalsは単一チケット取得（`GET /issues/{id}.json?include=journals`）でのみ
取得でき、一覧取得（`GET /issues.json`）の`include`が受け付けるのはattachments / relationsのみ**である。
そのため2段階で取得する。

1. `GET /issues.json?project_id={id}&tracker_id={ids}&status_id=*&updated_on=><{対象日00:00:00}|{対象日23:59:59}>`
   で対象日に更新のあったチケットのIDを取得する（ページネーションは5.1）。
2. 1で得た各チケットに対し`GET /issues/{id}.json?include=journals`を発行し、journalsを取得する。

各チケットの`journals[].details[]`のうち`property=attr`かつ`name=status_id`または
`name=assigned_to_id`で、`journals[].created_on`が対象日に含まれるものだけを変更点として採用する
（`updated_on`は他フィールドの変更でも更新されるため、実際に対象フィールドが変わったjournalのみを抽出する）。
値（ID）は`GET /issue_statuses.json`・プロジェクトメンバー一覧で名前に変換する。
同一チケットに複数の対象journalがある場合は時系列順に連結して表示する。

APIコール数は「対象日に更新のあったチケット数＋数件」で、通常は1日あたり数件〜数十件に収まる。

### 5.5 作業時間集計
`GET /time_entries.json?project_id={id}&spent_on={対象日}`（サブプロジェクトを含める場合は
5.2と同様にプロジェクトIDを展開する）。`time_entry.user`（作業時間を入力した利用者）ごとに
`hours`を合計する。合計時は生の値で加算し、表示の直前に小数点1桁へ丸める
（各値を丸めてから合計すると総和がずれるため）。

なお`spent_on`基準で集計するため、レポート生成後に当該日の工数が追加入力されても既存レポートには
反映されない（要件定義の制約事項どおり、必要な場合は手動再生成で最新化する）。

### 5.6 遅延・期限超過チケットの判定（対象日時点の状態を再構成）
バッチの実行時刻は対象日の翌営業日であり、Redmine APIから取得できるのは「現在の状態」であるため、
対象日23:59時点の状態を再構成してから判定する。
ただし全チケットのjournalsを取得すると、5.4のとおり単一チケット取得がチケット数ぶん発生して
API呼び出しが膨れ上がるため、まず一覧APIだけで候補を絞り込む。

**手順1：候補の絞り込み（一覧APIのみ）**
- 候補A：現在オープン（`status_id=open`）かつ現在の期日が対象日以前（`due_date=<={対象日}`）のチケット
- 候補B：対象日の翌日0:00以降に更新されたチケット（`updated_on=>={対象日の翌日}`、`status_id=*`）
  ― 対象日時点の状態が現在と異なりうるもの（対象日より後にクローズされた、期日が延長された等）

**手順2：状態の再構成（候補A∪Bに対してのみ単一チケット取得）**
1. 各候補に`GET /issues/{id}.json?include=journals`を発行する。
2. **現在値を起点に、`journals[].created_on`が対象日23:59より後のjournalを新しい順に打ち消す**
   （`details[].new_value`を`old_value`へ戻す）ことで、対象日時点のステータス・期日・進捗率・
   予定工数・担当者を復元する。現在値からの巻き戻しとすることで、チケット作成時の初期値を
   別途求める必要がなくなる。
3. 復元した状態が「ステータスの`is_closed`が偽」かつ「期日が対象日より前」であるチケットを
   遅延チケットとする。
4. 遅延時間 = 予定工数（Estimated hours）×（1 − 進捗率（Done ratio）÷100）。
   予定工数が未設定の場合は`delayedUncalculableIssues`に分類する。
5. 期日超過日数 = 対象日 − 期日（日数）。

APIコール数の目安は「現在の遅延チケット数 ＋ 直近1営業日の更新チケット数」で、数十件規模に収まる想定。
手動再生成は同期APIのため（1章）、この件数がリクエストタイムアウトに収まることを導入時に確認する。

※ Redmineのバージョン・運用によっては予定工数・進捗率の変更がjournalの`details`に記録されない場合が
あるため、実装時に対象Redmine環境で記録されることを確認する。記録されない場合は現在値を代替値として
使用する（誤差が生じうる旨を画面上に注記することを検討する）。

### 5.7 認証・接続
- `X-Redmine-API-Key`ヘッダでAPIキー認証を行う（`shared/src/redmineClient.ts`相当）。
- 参照のみを行うため、APIキーは閲覧権限のみを持つRedmineユーザーのものを使用することを推奨する。
- Redmine接続失敗・タイムアウトは自動リトライせず、要因が分かるメッセージのみを記録する
  （例：「Redmineへの接続に失敗しました」）。

## 6. 保持期間・クリーンアップ
- レポート（`reports/*.json`）・実行履歴（`run-history.json`の各エントリ）ともに、
  対象日が`config.retentionDays`（既定90日）より前になったものを削除対象とする。
- クリーンアップはレポート生成バッチの実行完了後、同一起動内で実行する（`sequence.md`6.）。
- 手動再生成で保持期間外の対象日を生成した場合も、次回のクリーンアップ処理で削除される
  （要件定義どおり、特別扱いはしない）。クリーンアップ実行前は一覧・詳細で参照できる。

## 7. Web閲覧アプリの認証
- 本番環境はIIS + iisnodeでホストし、IISのWindows統合認証を有効化・匿名認証を無効化する。
  IISが認証したアカウント名は`web.config`のURL RewriteルールによりX-Remote-Userヘッダーへ書き込む。
  このとき、**クライアントが自称した同名ヘッダーは必ず上書きする**（上書きしないと、任意のユーザー名を
  名乗ったリクエストをそのまま受け付けてしまう）。Nodeプロセス自体は既定でループバック（127.0.0.1）のみを
  待ち受け、LANからはIIS経由でしか到達できないようにする。
- 非Windowsの開発・検証環境では、環境変数（例：`PMREPORT_DEV_USER`）でログインユーザー名を
  指定できる代替手段を用意する。この環境変数はIIS配下（X-Remote-Userが付与される環境）では無視し、
  本番で認証を迂回できないようにする。

## 8. 未確定事項への決定・初期値（提案）
| 項目 | 決定内容 |
|---|---|
| Web閲覧アプリ・バッチの技術スタック | Node.js + TypeScript／Express／JSONファイル（DB不使用）／axios、IIS+iisnodeでホスト |
| 手動再生成の実行方式 | 別プロセスを起動せず、Web閲覧アプリから`shared`の生成ロジックを同期呼び出し |
| タスクスケジューラの起動スケジュール | 平日（月〜金）1日1回。時刻は導入環境で設定（例：6:00） |
| 対象日の算出 | 起動日の直前の営業日（月〜金）。月曜起動時は前週金曜日。祝日は考慮しない |
| journalsの取得方式 | 一覧APIでは取得できないため、候補を一覧APIで絞り込んだうえで単一チケット取得を発行 |
| 対象日時点の状態復元 | 現在値を起点に、対象日より後のjournalを新しい順に打ち消す（巻き戻し） |
| ページネーション | `limit=100`＋`offset`で`total_count`に達するまでループ |
| 保持期間の初期値 | 90日（`config.json`の`retentionDays`で変更可能） |
| 期間指定エクスポートの上限 | 31日 |
| 遅延時間の算出式 | 予定工数 ×（1 − 進捗率／100） |
| ファイルロック | `proper-lockfile`等を使用し、`reports/{対象日}.json`単位・`run-history.json`単位でロック |
| 実行ログ（本仕組み自体のデバッグログ）の保存 | 当面は`run-history.json`の成功/失敗記録のみとし、詳細な技術ログは別途アプリケーションログ（ファイル出力等）に残すが画面には表示しない |

## 9. 非機能設計
- **排他制御**：`reports/{対象日}.json`・`run-history.json`の更新時にファイルロックを取得し、
  自動バッチとWeb閲覧アプリ（手動再生成）の同時書き込みによる不整合を防止する。
- **異常系**：Redmine接続失敗・タイムアウトはレポートを`status=failed`として保存し、
  自動リトライは行わない。次回のスケジュール起動には影響を与えない。
- **性能**：Redmine APIの呼び出し回数を抑えるため、遅延判定では候補を絞り込んでから
  単一チケット取得を行う（5.6）。一覧取得はページネーションで全件を確実に取得する（5.1）。
- **セキュリティ**：Redmine APIキーは`config/config.json`（.gitignore対象）で管理し、
  リポジトリにコミットしない。Web画面はLAN内にHTTPで公開し、Windows統合認証でアクセス制御する
  （HTTPS化は行わない）。X-Remote-Userヘッダーの偽装対策は7章のとおり。
- **保持期間管理**：レポート・実行履歴とも対象日基準で90日（設定可能）を超えたものを自動削除する。
- **タイムゾーン**：JST固定。日付境界の扱いは5.1のとおり。

## 10. 実装マイルストーン（案）
1. `shared`：Redmine連携（issues／journals／time_entries取得、ページネーション、日付境界処理）の実装
2. `shared`：対象日時点の状態復元・遅延判定・集計ロジックの実装（ユニットテストを厚めに）
3. `shared`：レポートJSON⇔Markdown変換ロジックの実装
4. `batch`：対象日算出（営業日判定）・レポート生成・保持期間クリーンアップ・実行履歴記録・排他制御
5. `webapp`：レポート一覧／詳細／実行履歴のAPI・画面（`api-design.md`・`screen-spec.md`準拠）
6. `webapp`：手動再生成・単日／期間指定Markdownエクスポート
7. IIS + Windows認証の統合（X-Remote-User上書きの検証を含む）、タスクスケジューラ登録手順のドキュメント化
8. 実データでの動作確認（状態復元ロジック・日付境界・サブプロジェクト集計を中心にRedmine実環境で検証）
