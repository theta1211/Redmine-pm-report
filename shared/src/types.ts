export interface AppConfig {
  redmine: {
    url: string;
    apiKey: string;
  };
  project: {
    identifier: string;
    includeSubprojects: boolean;
  };
  /** 集計対象トラッカー名。空配列の場合は全トラッカーを対象とする */
  trackers: string[];
  /** レポート・実行履歴の保持日数（対象日基準） */
  retentionDays: number;
  export: {
    maxRangeDays: number;
  };
  dataDir: string;
}

export type ReportStatus = "success" | "failed";

export interface ReportSummary {
  newCount: number;
  updatedCount: number;
  totalSpentHours: number;
  /** 遅延チケットの総数（計算可能分＋計算不可分） */
  delayedCount: number;
  /** delayedCountのうち、予定工数未設定で遅延時間を算出できなかった件数（内数） */
  delayedUncalculableCount: number;
}

export interface NewIssue {
  id: number;
  subject: string;
  author: string;
  tracker: string;
  priority: string;
  assignee: string;
  dueDate: string | null;
}

export type ChangedField = "status" | "assignee";

export interface IssueChange {
  field: ChangedField;
  from: string;
  to: string;
}

export interface UpdatedIssue {
  id: number;
  subject: string;
  changes: IssueChange[];
}

/** 作業時間を入力した利用者（Redmineのtime_entry.user）単位の集計。チケットの担当者とは別物 */
export interface SpentTimeEntry {
  user: string;
  hours: number;
}

export interface DelayedIssue {
  id: number;
  subject: string;
  assignee: string;
  dueDate: string;
  overdueDays: number;
  estimatedHours: number;
  doneRatio: number;
  delayHours: number;
}

export interface DelayedUncalculableIssue {
  id: number;
  subject: string;
  assignee: string;
  dueDate: string;
  overdueDays: number;
}

export interface SuccessReport {
  targetDate: string;
  status: "success";
  generatedAt: string;
  summary: ReportSummary;
  newIssues: NewIssue[];
  updatedIssues: UpdatedIssue[];
  spentTime: SpentTimeEntry[];
  delayedIssues: DelayedIssue[];
  delayedUncalculableIssues: DelayedUncalculableIssue[];
  errorMessage: null;
}

export interface FailedReport {
  targetDate: string;
  status: "failed";
  generatedAt: string;
  errorMessage: string;
}

export type Report = SuccessReport | FailedReport;

export type RunTrigger = "scheduled" | "manual";

export interface RunHistoryEntry {
  runId: string;
  targetDate: string;
  trigger: RunTrigger;
  /** 手動実行時のWindows認証アカウント名。自動実行時はnull */
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string;
  status: ReportStatus;
  errorMessage: string | null;
}

export interface RunHistory {
  items: RunHistoryEntry[];
}
