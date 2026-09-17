import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationInProgressError, RedmineUnavailableError } from "../errors";
import { withLockFile } from "../jsonStore";
import { cleanupOldData, reportLockPath, runReportGeneration } from "../reportService";
import { listReportDates, readReport, saveReport } from "../reportStore";
import { appendRunHistory, listRunHistory } from "../runHistoryStore";
import type { AppConfig, RedmineClient, Report, RunHistoryEntry } from "../index";

let dataDir: string;
let config: AppConfig;

function buildConfig(dir: string): AppConfig {
  return {
    redmine: { url: "https://redmine.example.co.jp", apiKey: "dummy" },
    project: { identifier: "sample-project", includeSubprojects: true },
    trackers: [],
    retentionDays: 90,
    export: { maxRangeDays: 31 },
    dataDir: dir,
  };
}

function successReport(targetDate: string): Report {
  return {
    targetDate,
    status: "success",
    generatedAt: "2026-09-15T06:00:03+09:00",
    summary: {
      newCount: 0,
      updatedCount: 0,
      totalSpentHours: 0,
      delayedCount: 0,
      delayedUncalculableCount: 0,
    },
    newIssues: [],
    updatedIssues: [],
    spentTime: [],
    delayedIssues: [],
    delayedUncalculableIssues: [],
    errorMessage: null,
  };
}

function historyEntry(targetDate: string): RunHistoryEntry {
  return {
    runId: `run-${targetDate}`,
    targetDate,
    trigger: "scheduled",
    triggeredBy: null,
    startedAt: `${targetDate}T06:00:00+09:00`,
    finishedAt: `${targetDate}T06:00:03+09:00`,
    status: "success",
    errorMessage: null,
  };
}

beforeEach(async () => {
  dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pm-report-store-"));
  config = buildConfig(dataDir);
});

afterEach(async () => {
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

describe("reportStore", () => {
  it("保存・読み込み・一覧（対象日の降順）ができる", async () => {
    await saveReport(config, successReport("2026-09-11"));
    await saveReport(config, successReport("2026-09-15"));

    expect(await listReportDates(config)).toEqual(["2026-09-15", "2026-09-11"]);
    expect((await readReport(config, "2026-09-11"))?.targetDate).toBe("2026-09-11");
    expect(await readReport(config, "2026-09-12")).toBeUndefined();
  });
});

describe("cleanupOldData", () => {
  it("対象日が保持期間より前のレポートと実行履歴を削除する", async () => {
    await saveReport(config, successReport("2026-06-01")); // 100日以上前
    await saveReport(config, successReport("2026-09-14"));
    await appendRunHistory(config, historyEntry("2026-06-01"));
    await appendRunHistory(config, historyEntry("2026-09-14"));

    const result = await cleanupOldData(config, "2026-09-15");

    expect(result.deletedReports).toEqual(["2026-06-01"]);
    expect(result.deletedRunHistory).toBe(1);
    expect(await listReportDates(config)).toEqual(["2026-09-14"]);
    expect((await listRunHistory(config)).map((h) => h.targetDate)).toEqual(["2026-09-14"]);
  });

  it("保持期間の境界（90日ちょうど）は削除し、89日は残す", async () => {
    await saveReport(config, successReport("2026-06-17")); // 2026-09-15の90日前
    await saveReport(config, successReport("2026-06-18")); // 89日前

    const result = await cleanupOldData(config, "2026-09-15");

    expect(result.deletedReports).toEqual(["2026-06-17"]);
    expect(await listReportDates(config)).toEqual(["2026-06-18"]);
  });
});

describe("runReportGeneration", () => {
  it("Redmine接続に失敗した場合は生成失敗として保存し、実行履歴にも記録する", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingClient = {
      listProjects: async () => {
        throw new RedmineUnavailableError("connect ECONNREFUSED");
      },
      listTrackers: async () => [],
      listIssueStatuses: async () => [],
    } as unknown as RedmineClient;

    const report = await runReportGeneration({
      config,
      targetDate: "2026-09-14",
      trigger: "manual",
      triggeredBy: "DOMAIN\\sato",
      client: failingClient,
    });

    expect(report.status).toBe("failed");
    // 技術的な詳細は画面に出さず、要因が分かるメッセージのみ残す
    expect(report.errorMessage).toBe("Redmineへの接続に失敗しました");
    expect((await readReport(config, "2026-09-14"))?.status).toBe("failed");

    const history = await listRunHistory(config);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      targetDate: "2026-09-14",
      trigger: "manual",
      triggeredBy: "DOMAIN\\sato",
      status: "failed",
      errorMessage: "Redmineへの接続に失敗しました",
    });
    errorSpy.mockRestore();
  });

  it("同一対象日が処理中の場合はGenerationInProgressErrorを投げる", async () => {
    const lockPath = reportLockPath(config, "2026-09-14");
    let releaseHold: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holder = withLockFile(lockPath, () => held);
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(
      runReportGeneration({
        config,
        targetDate: "2026-09-14",
        trigger: "scheduled",
        client: {} as RedmineClient,
      })
    ).rejects.toBeInstanceOf(GenerationInProgressError);

    releaseHold();
    await holder;
  });
});
