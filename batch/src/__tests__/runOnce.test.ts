import {
  listReportDates,
  listRunHistory,
  readReport,
  saveReport,
  type AppConfig,
  type RedmineClient,
  type Report,
} from "@pmreport/shared";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTargetDateArg, runOnce } from "../runOnce";

let dataDir: string;
let config: AppConfig;

function emptyReport(targetDate: string): Report {
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

beforeEach(async () => {
  dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pm-report-batch-"));
  config = {
    redmine: { url: "https://redmine.example.co.jp", apiKey: "dummy" },
    // 対象プロジェクトが見つからず生成失敗になる設定（バッチの配線と対象日算出の検証用）
    project: { identifier: "missing-project", includeSubprojects: true },
    trackers: [],
    retentionDays: 90,
    export: { maxRangeDays: 31 },
    dataDir,
  };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

/** 対象プロジェクトが存在しない応答を返し、生成失敗の経路を通す */
const emptyClient = {
  listProjects: async () => [],
  listTrackers: async () => [],
  listIssueStatuses: async () => [],
} as unknown as RedmineClient;

describe("parseTargetDateArg", () => {
  it("--date を解釈する", () => {
    expect(parseTargetDateArg(["--date=2026-09-11"])).toBe("2026-09-11");
    expect(parseTargetDateArg([])).toBeUndefined();
    expect(() => parseTargetDateArg(["--date=2026/09/11"])).toThrow();
  });
});

describe("runOnce", () => {
  it("月曜日に起動すると前週金曜日を対象日にする", async () => {
    // 2026-09-14(月) 06:00 JST
    const result = await runOnce({
      config,
      client: emptyClient,
      now: new Date("2026-09-13T21:00:00Z"),
    });

    expect(result.targetDate).toBe("2026-09-11");
    expect(result.status).toBe("failed");
    expect(await listReportDates(config)).toEqual(["2026-09-11"]);
    expect((await listRunHistory(config))[0]).toMatchObject({
      targetDate: "2026-09-11",
      trigger: "scheduled",
      triggeredBy: null,
      status: "failed",
    });
  });

  it("--date相当の指定があればその日を対象日にする", async () => {
    const result = await runOnce({
      config,
      targetDate: "2026-09-09",
      client: emptyClient,
      now: new Date("2026-09-13T21:00:00Z"),
    });

    expect(result.targetDate).toBe("2026-09-09");
    expect(await readReport(config, "2026-09-09")).toBeDefined();
  });

  it("生成後に保持期間外のレポートを削除する", async () => {
    await saveReport(config, emptyReport("2026-01-05"));

    const result = await runOnce({
      config,
      client: emptyClient,
      now: new Date("2026-09-13T21:00:00Z"),
    });

    expect(result.deletedReports).toEqual(["2026-01-05"]);
    expect(await listReportDates(config)).toEqual(["2026-09-11"]);
  });

  it("生成に失敗しても例外を投げず、失敗として結果を返す", async () => {
    const result = await runOnce({
      config,
      targetDate: "2026-09-11",
      client: emptyClient,
      now: new Date("2026-09-13T21:00:00Z"),
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("対象プロジェクトがRedmine上に見つかりません");
  });
});
