import {
  cleanupOldData,
  isValidDateString,
  loadConfig,
  previousBusinessDay,
  runReportGeneration,
  todayInJst,
  type AppConfig,
  type RedmineClient,
  type ReportStatus,
} from "@pmreport/shared";

export interface RunOnceOptions {
  config?: AppConfig;
  /** 省略時は起動日の直前の営業日（月〜金）を対象日とする */
  targetDate?: string;
  /** テスト用にRedmineクライアントを差し替える */
  client?: RedmineClient;
  now?: Date;
}

export interface RunOnceResult {
  targetDate: string;
  status: ReportStatus;
  errorMessage: string | null;
  deletedReports: string[];
  deletedRunHistory: number;
}

/** `--date=YYYY-MM-DD` を解釈する（欠測日の手動補完用） */
export function parseTargetDateArg(argv: string[]): string | undefined {
  const arg = argv.find((value) => value.startsWith("--date="));
  if (!arg) return undefined;
  const value = arg.slice("--date=".length);
  if (!isValidDateString(value)) {
    throw new Error(`--date の形式が不正です（YYYY-MM-DD）: ${value}`);
  }
  return value;
}

export async function runOnce(options: RunOnceOptions = {}): Promise<RunOnceResult> {
  const config = options.config ?? loadConfig();
  const now = options.now ?? new Date();
  const today = todayInJst(now);
  const targetDate = options.targetDate ?? previousBusinessDay(today);

  const report = await runReportGeneration({
    config,
    targetDate,
    trigger: "scheduled",
    client: options.client,
    now: options.now,
  });
  const cleanup = await cleanupOldData(config, today);

  return {
    targetDate,
    status: report.status,
    errorMessage: report.status === "failed" ? report.errorMessage : null,
    deletedReports: cleanup.deletedReports,
    deletedRunHistory: cleanup.deletedRunHistory,
  };
}
