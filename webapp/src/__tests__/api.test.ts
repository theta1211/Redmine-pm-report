import { saveReport, type AppConfig, type RedmineClient, type Report } from "@pmreport/shared";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";

const USER = "DOMAIN\\sato";
const NOW = new Date("2026-09-15T21:00:00Z"); // JST 2026-09-16 06:00

let dataDir: string;
let config: AppConfig;

/** 対象プロジェクトが見つからない応答を返し、手動再生成が「生成失敗」になる経路を通す */
const failingClient = {
  listProjects: async () => [],
  listTrackers: async () => [],
  listIssueStatuses: async () => [],
} as unknown as RedmineClient;

function successReport(targetDate: string): Report {
  return {
    targetDate,
    status: "success",
    generatedAt: "2026-09-15T06:00:03+09:00",
    summary: {
      newCount: 1,
      updatedCount: 2,
      totalSpentHours: 7.5,
      delayedCount: 1,
      delayedUncalculableCount: 0,
    },
    newIssues: [
      {
        id: 10,
        subject: "会員登録画面の対応",
        author: "田中",
        tracker: "タスク",
        priority: "通常",
        assignee: "佐藤",
        dueDate: "2026-09-20",
      },
    ],
    updatedIssues: [
      { id: 20, subject: "バッチ修正", changes: [{ field: "status", from: "新規", to: "進行中" }] },
    ],
    spentTime: [{ user: "佐藤", hours: 7.5 }],
    delayedIssues: [
      {
        id: 30,
        subject: "旧管理画面の廃止",
        assignee: "鈴木",
        dueDate: "2026-09-10",
        overdueDays: 4,
        estimatedHours: 10,
        doneRatio: 40,
        delayHours: 6,
      },
    ],
    delayedUncalculableIssues: [],
    errorMessage: null,
  };
}

function failedReport(targetDate: string): Report {
  return {
    targetDate,
    status: "failed",
    generatedAt: "2026-09-13T06:00:04+09:00",
    errorMessage: "Redmineへの接続に失敗しました",
  };
}

function buildApp() {
  return createApp({ config, client: failingClient, now: () => NOW });
}

beforeEach(async () => {
  dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pm-report-api-"));
  config = {
    redmine: { url: "https://redmine.example.co.jp", apiKey: "dummy" },
    project: { identifier: "sample-project", includeSubprojects: true },
    trackers: ["タスク", "バグ"],
    retentionDays: 90,
    export: { maxRangeDays: 31 },
    dataDir,
  };
  delete process.env.PMREPORT_DEV_USER;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await saveReport(config, successReport("2026-09-14"));
  await saveReport(config, successReport("2026-09-15"));
  await saveReport(config, failedReport("2026-09-11"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

describe("認証", () => {
  it("ユーザーを特定できない場合は401を返す", async () => {
    const res = await request(buildApp()).get("/api/reports");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("X-Remote-Userがあれば認証済みとして扱う", async () => {
    const res = await request(buildApp()).get("/api/whoami").set("X-Remote-User", USER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: USER });
  });
});

describe("GET /api/reports", () => {
  it("対象日の降順で一覧を返す", async () => {
    const res = await request(buildApp()).get("/api/reports").set("X-Remote-User", USER);

    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { targetDate: string }) => item.targetDate)).toEqual([
      "2026-09-15",
      "2026-09-14",
      "2026-09-11",
    ]);
    expect(res.body.items[0].summary.totalSpentHours).toBe(7.5);
    expect(res.body.items[2]).toMatchObject({
      status: "failed",
      errorMessage: "Redmineへの接続に失敗しました",
    });
  });
});

describe("GET /api/reports/:date", () => {
  it("レポート詳細を返す", async () => {
    const res = await request(buildApp()).get("/api/reports/2026-09-14").set("X-Remote-User", USER);
    expect(res.status).toBe(200);
    expect(res.body.delayedIssues[0].delayHours).toBe(6);
  });

  it("存在しない日付は404を返す", async () => {
    const res = await request(buildApp()).get("/api/reports/2026-09-13").set("X-Remote-User", USER);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("REPORT_NOT_FOUND");
  });
});

describe("GET /api/reports/:date/export", () => {
  it("Markdownファイルとして返す", async () => {
    const res = await request(buildApp())
      .get("/api/reports/2026-09-14/export")
      .set("X-Remote-User", USER);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toContain('filename="report_2026-09-14.md"');
    expect(res.text).toContain("# 日次レポート 2026-09-14");
  });

  it("生成失敗のレポートは409を返す", async () => {
    const res = await request(buildApp())
      .get("/api/reports/2026-09-11/export")
      .set("X-Remote-User", USER);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REPORT_FAILED");
  });
});

describe("GET /api/reports/export", () => {
  it("期間内の成功レポートをまとめて返す", async () => {
    const res = await request(buildApp())
      .get("/api/reports/export?from=2026-09-11&to=2026-09-15")
      .set("X-Remote-User", USER);

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain('filename="report_2026-09-11_2026-09-15.md"');
    expect(res.text).toContain("# 日次レポート 2026-09-11 〜 2026-09-15");
    expect(res.text).toContain("## 日次レポート 2026-09-14");
    // 生成失敗・未生成の日は対象外として列挙する
    expect(res.text).toContain("- 2026-09-11（レポートなし、または生成失敗）");
    expect(res.text).toContain("- 2026-09-12（レポートなし、または生成失敗）");
  });

  it("上限日数を超える期間は400を返す", async () => {
    const res = await request(buildApp())
      .get("/api/reports/export?from=2026-07-01&to=2026-09-15")
      .set("X-Remote-User", USER);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RANGE");
  });

  it("期間内に成功レポートがなければ404を返す", async () => {
    const res = await request(buildApp())
      .get("/api/reports/export?from=2026-09-11&to=2026-09-12")
      .set("X-Remote-User", USER);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NO_REPORTS_IN_RANGE");
  });

  it("日付形式が不正な場合は400を返す", async () => {
    const res = await request(buildApp())
      .get("/api/reports/export?from=2026-9-1&to=2026-09-15")
      .set("X-Remote-User", USER);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RANGE");
  });
});

describe("POST /api/reports/:date/regenerate", () => {
  it("生成に失敗した場合もレポートを200で返し、実行履歴に手動実行として残す", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/reports/2026-09-14/regenerate")
      .set("X-Remote-User", USER);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");

    const history = await request(app).get("/api/run-history").set("X-Remote-User", USER);
    expect(history.body.items[0]).toMatchObject({
      targetDate: "2026-09-14",
      trigger: "manual",
      triggeredBy: USER,
      status: "failed",
    });
  });

  it("未来日は400を返す", async () => {
    const res = await request(buildApp())
      .post("/api/reports/2026-09-17/regenerate")
      .set("X-Remote-User", USER);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE");
  });

  it("日付形式が不正な場合は400を返す", async () => {
    const res = await request(buildApp())
      .post("/api/reports/not-a-date/regenerate")
      .set("X-Remote-User", USER);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE");
  });
});

describe("GET /api/app-info", () => {
  it("画面表示用の設定値を返す（APIキーは含めない）", async () => {
    const res = await request(buildApp()).get("/api/app-info").set("X-Remote-User", USER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      project: { identifier: "sample-project", includeSubprojects: true },
      trackers: ["タスク", "バグ"],
      retentionDays: 90,
      maxRangeDays: 31,
      today: "2026-09-16",
    });
    expect(JSON.stringify(res.body)).not.toContain("dummy");
  });
});
