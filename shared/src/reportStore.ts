import * as fs from "node:fs";
import * as path from "node:path";
import { diffDays, isValidDateString } from "./dates";
import { readJson, writeJsonAtomic } from "./jsonStore";
import type { AppConfig, Report } from "./types";

export function reportsDir(config: AppConfig): string {
  return path.join(config.dataDir, "reports");
}

export function reportPath(config: AppConfig, targetDate: string): string {
  return path.join(reportsDir(config), `${targetDate}.json`);
}

export async function saveReport(config: AppConfig, report: Report): Promise<void> {
  await writeJsonAtomic(reportPath(config, report.targetDate), report);
}

export async function readReport(config: AppConfig, targetDate: string): Promise<Report | undefined> {
  try {
    return await readJson<Report>(reportPath(config, targetDate));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** 保存されているレポートの対象日を降順で返す */
export async function listReportDates(config: AppConfig): Promise<string[]> {
  let files: string[];
  try {
    files = await fs.promises.readdir(reportsDir(config));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .filter((date) => isValidDateString(date))
    .sort((a, b) => (a < b ? 1 : -1));
}

export async function listReports(config: AppConfig): Promise<Report[]> {
  const dates = await listReportDates(config);
  const reports: Report[] = [];
  for (const date of dates) {
    const report = await readReport(config, date);
    if (report) reports.push(report);
  }
  return reports;
}

export async function deleteReport(config: AppConfig, targetDate: string): Promise<void> {
  await fs.promises.rm(reportPath(config, targetDate), { force: true });
}

/**
 * 対象日が保持期間より前になったレポートを削除する。
 * 手動再生成で保持期間外の日付を生成した場合も、このクリーンアップで削除される。
 */
export async function cleanupReports(config: AppConfig, today: string): Promise<string[]> {
  const deleted: string[] = [];
  for (const date of await listReportDates(config)) {
    if (diffDays(today, date) >= config.retentionDays) {
      await deleteReport(config, date);
      deleted.push(date);
    }
  }
  return deleted;
}
