import * as path from "node:path";
import { toJstIsoString, toRunId } from "./dates";
import { ConfigurationError, GenerationInProgressError, RedmineUnavailableError } from "./errors";
import { withLockFile } from "./jsonStore";
import type { RedmineClient } from "./redmineClient";
import { generateReport } from "./reportGenerator";
import { cleanupReports, saveReport } from "./reportStore";
import { appendRunHistory, cleanupRunHistory } from "./runHistoryStore";
import type { AppConfig, Report, RunTrigger } from "./types";

export interface RunReportGenerationOptions {
  config: AppConfig;
  targetDate: string;
  trigger: RunTrigger;
  /** 手動実行時のログインユーザー名 */
  triggeredBy?: string | null;
  client?: RedmineClient;
  now?: Date;
}

/** 画面・レポートに残すのは要因が分かるメッセージのみとし、技術的な詳細はログに留める */
function toUserFacingMessage(err: unknown): string {
  if (err instanceof RedmineUnavailableError) return "Redmineへの接続に失敗しました";
  if (err instanceof ConfigurationError) return err.message;
  return "レポートの生成中にエラーが発生しました";
}

export function reportLockPath(config: AppConfig, targetDate: string): string {
  return path.join(config.dataDir, "locks", `report-${targetDate}.lock`);
}

/**
 * 対象日のレポートを生成して保存し、実行履歴を記録する。
 * 自動バッチ・手動再生成の共通入口で、同一対象日に対する多重実行はロックで防ぐ。
 */
export async function runReportGeneration(options: RunReportGenerationOptions): Promise<Report> {
  const { config, targetDate, trigger } = options;
  const startedAt = options.now ?? new Date();

  try {
    return await withLockFile(reportLockPath(config, targetDate), async () => {
      let report: Report;
      try {
        report = await generateReport({
          config,
          targetDate,
          client: options.client,
          now: options.now,
        });
      } catch (err) {
        console.error(`[pm-report] レポート生成に失敗しました (${targetDate})`, err);
        report = {
          targetDate,
          status: "failed",
          generatedAt: toJstIsoString(options.now ?? new Date()),
          errorMessage: toUserFacingMessage(err),
        };
      }

      await saveReport(config, report);
      await appendRunHistory(config, {
        runId: toRunId(startedAt),
        targetDate,
        trigger,
        triggeredBy: options.triggeredBy ?? null,
        startedAt: toJstIsoString(startedAt),
        finishedAt: toJstIsoString(options.now ?? new Date()),
        status: report.status,
        errorMessage: report.status === "failed" ? report.errorMessage : null,
      });
      return report;
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ELOCKED") {
      throw new GenerationInProgressError(targetDate);
    }
    throw err;
  }
}

export interface CleanupResult {
  deletedReports: string[];
  deletedRunHistory: number;
}

export async function cleanupOldData(config: AppConfig, today: string): Promise<CleanupResult> {
  const deletedReports = await cleanupReports(config, today);
  const deletedRunHistory = await cleanupRunHistory(config, today);
  return { deletedReports, deletedRunHistory };
}
