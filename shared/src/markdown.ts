import type { Report, SuccessReport } from "./types";

function escapeCell(value: string | number | null): string {
  if (value === null) return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function table(headers: string[], rows: (string | number | null)[][]): string[] {
  if (rows.length === 0) return ["該当なし", ""];
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    "",
  ];
}

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

function summaryLines(report: SuccessReport, level: number): string[] {
  const { summary } = report;
  return [
    heading(level, "サマリ"),
    "",
    `- 新規登録: ${summary.newCount}件`,
    `- 更新: ${summary.updatedCount}件`,
    `- 作業時間合計: ${summary.totalSpentHours.toFixed(1)}h`,
    `- 遅延: ${summary.delayedCount}件（うち計算不可 ${summary.delayedUncalculableCount}件）`,
    "",
  ];
}

export interface RenderOptions {
  /** 見出しレベル（期間エクスポートで日ごとの詳細を1段下げるために使う） */
  headingLevel?: number;
}

export function renderReportMarkdown(report: Report, options: RenderOptions = {}): string {
  const level = options.headingLevel ?? 1;
  const lines: string[] = [heading(level, `日次レポート ${report.targetDate}`), ""];

  if (report.status === "failed") {
    lines.push(`レポートの生成に失敗しました: ${report.errorMessage}`, "");
    return lines.join("\n");
  }

  lines.push(`生成日時: ${report.generatedAt}`, "");
  lines.push(...summaryLines(report, level + 1));

  lines.push(heading(level + 1, "新規登録チケット"), "");
  lines.push(
    ...table(
      ["#", "件名", "起票者", "トラッカー", "優先度", "担当", "期日"],
      report.newIssues.map((issue) => [
        `#${issue.id}`,
        issue.subject,
        issue.author,
        issue.tracker,
        issue.priority,
        issue.assignee,
        issue.dueDate,
      ])
    )
  );

  lines.push(heading(level + 1, "更新チケット（ステータス・担当者の変更）"), "");
  lines.push(
    ...table(
      ["#", "件名", "変更内容"],
      report.updatedIssues.map((issue) => [
        `#${issue.id}`,
        issue.subject,
        issue.changes
          .map(
            (change) =>
              `${change.field === "status" ? "ステータス" : "担当者"}: ${change.from} → ${change.to}`
          )
          .join("、 "),
      ])
    )
  );

  lines.push(heading(level + 1, "作業時間（入力者別）"), "");
  lines.push(
    ...table(
      ["入力者", "時間"],
      report.spentTime.map((entry) => [entry.user, `${entry.hours.toFixed(1)}h`])
    )
  );

  lines.push(heading(level + 1, "遅延チケット（遅延時間の降順）"), "");
  lines.push(
    ...table(
      ["#", "件名", "担当", "期日", "超過日数", "予定工数", "進捗", "遅延時間"],
      report.delayedIssues.map((issue) => [
        `#${issue.id}`,
        issue.subject,
        issue.assignee,
        issue.dueDate,
        `${issue.overdueDays}日`,
        `${issue.estimatedHours.toFixed(1)}h`,
        `${issue.doneRatio}%`,
        `${issue.delayHours.toFixed(1)}h`,
      ])
    )
  );

  if (report.delayedUncalculableIssues.length > 0) {
    lines.push(heading(level + 2, "計算不可（工数未設定）"), "");
    lines.push(
      ...table(
        ["#", "件名", "担当", "期日", "超過日数"],
        report.delayedUncalculableIssues.map((issue) => [
          `#${issue.id}`,
          issue.subject,
          issue.assignee,
          issue.dueDate,
          `${issue.overdueDays}日`,
        ])
      )
    );
  }

  return lines.join("\n");
}

export interface RangeRenderParams {
  from: string;
  to: string;
  /** 対象日の昇順で並んだ成功レポート */
  reports: SuccessReport[];
  /** レポートが存在しない、または生成失敗だった日付 */
  missingDates: string[];
}

export function renderRangeMarkdown(params: RangeRenderParams): string {
  const { from, to, reports, missingDates } = params;
  const totalNew = reports.reduce((sum, r) => sum + r.summary.newCount, 0);
  const totalUpdated = reports.reduce((sum, r) => sum + r.summary.updatedCount, 0);
  const totalHours = reports.reduce((sum, r) => sum + r.summary.totalSpentHours, 0);
  const latest = reports[reports.length - 1];

  const lines: string[] = [
    `# 日次レポート ${from} 〜 ${to}`,
    "",
    "## 期間サマリ",
    "",
    `- 対象レポート: ${reports.length}日分`,
    `- 新規登録 合計: ${totalNew}件`,
    `- 更新 合計: ${totalUpdated}件（延べ。同一チケットが複数日更新された場合は日ごとに計上）`,
    `- 作業時間 合計: ${(Math.round(totalHours * 10) / 10).toFixed(1)}h`,
    latest
      ? `- 遅延（${latest.targetDate}時点）: ${latest.summary.delayedCount}件（うち計算不可 ${latest.summary.delayedUncalculableCount}件）`
      : "- 遅延: 集計対象のレポートがありません",
    "",
  ];

  for (const report of reports) {
    lines.push("---", "");
    lines.push(renderReportMarkdown(report, { headingLevel: 2 }));
  }

  if (missingDates.length > 0) {
    lines.push("---", "", "## 対象外の日付", "");
    lines.push(...missingDates.map((date) => `- ${date}（レポートなし、または生成失敗）`), "");
  }

  return lines.join("\n");
}
