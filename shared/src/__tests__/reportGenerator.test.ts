import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../errors";
import type { QueryParams, RedmineClient, RedmineIssue, RedmineTimeEntry } from "../redmineClient";
import { generateReport } from "../reportGenerator";
import type { AppConfig } from "../types";

const TARGET_DATE = "2026-09-14";
const NOW = new Date("2026-09-14T21:00:03Z");

const config: AppConfig = {
  redmine: { url: "https://redmine.example.co.jp", apiKey: "dummy" },
  project: { identifier: "sample-project", includeSubprojects: true },
  trackers: ["タスク", "バグ"],
  retentionDays: 90,
  export: { maxRangeDays: 31 },
  dataDir: "/tmp/unused",
};

const projects = [
  { id: 1, name: "サンプル", identifier: "sample-project" },
  { id: 2, name: "子プロジェクト", identifier: "sample-child", parent: { id: 1 } },
];
const trackers = [
  { id: 1, name: "タスク" },
  { id: 2, name: "バグ" },
  { id: 3, name: "雑談" },
];
const statuses = [
  { id: 1, name: "新規", is_closed: false },
  { id: 2, name: "進行中", is_closed: false },
  { id: 5, name: "完了", is_closed: true },
];
const members = [
  { id: 1, name: "田中" },
  { id: 2, name: "佐藤" },
  { id: 3, name: "鈴木" },
];

function issue(base: Partial<RedmineIssue> & { id: number }): RedmineIssue {
  return {
    subject: `チケット${base.id}`,
    created_on: "2026-09-01T00:00:00Z",
    updated_on: "2026-09-10T00:00:00Z",
    tracker: { id: 1, name: "タスク" },
    status: { id: 2, name: "進行中" },
    ...base,
  } as RedmineIssue;
}

const newIssue = issue({
  id: 10,
  subject: "会員登録画面のレスポンシブ対応",
  created_on: "2026-09-14T02:00:00Z",
  updated_on: "2026-09-14T02:00:00Z",
  author: { id: 1, name: "田中" },
  priority: { id: 2, name: "通常" },
  due_date: null,
});

const updatedIssue = issue({
  id: 20,
  subject: "在庫連携バッチのエラー修正",
  updated_on: "2026-09-14T03:00:00Z",
  journals: [
    {
      id: 1,
      created_on: "2026-09-14T03:00:00Z",
      details: [{ property: "attr", name: "status_id", old_value: "1", new_value: "2" }],
    },
  ],
});

// 説明文だけが変わったチケット（更新一覧には載らない）
const descriptionOnlyIssue = issue({
  id: 21,
  updated_on: "2026-09-14T04:00:00Z",
  journals: [
    {
      id: 2,
      created_on: "2026-09-14T04:00:00Z",
      details: [{ property: "attr", name: "description", old_value: "a", new_value: "b" }],
    },
  ],
});

const overdueIssue = issue({
  id: 30,
  subject: "旧管理画面の廃止対応",
  assigned_to: { id: 3, name: "鈴木" },
  due_date: "2026-09-10",
  done_ratio: 40,
  estimated_hours: 10,
  updated_on: "2026-09-13T00:00:00Z",
});

// 対象日より後にクローズされたチケット（対象日時点ではオープンなので遅延に含める）
const closedAfterTargetIssue = issue({
  id: 31,
  subject: "顧客データ移行スクリプト",
  status: { id: 5, name: "完了", is_closed: true },
  assigned_to: { id: 2, name: "佐藤" },
  due_date: "2026-09-08",
  done_ratio: 100,
  estimated_hours: 4,
  updated_on: "2026-09-15T01:00:00Z",
  journals: [
    {
      id: 3,
      created_on: "2026-09-15T01:00:00Z",
      details: [
        { property: "attr", name: "status_id", old_value: "2", new_value: "5" },
        { property: "attr", name: "done_ratio", old_value: "20", new_value: "100" },
      ],
    },
  ],
});

const noEstimateIssue = issue({
  id: 32,
  subject: "旧システムのログ調査",
  due_date: "2026-09-12",
  done_ratio: 0,
  estimated_hours: null,
  updated_on: "2026-09-13T00:00:00Z",
});

// 期日が対象日より後のため遅延ではない
const notOverdueIssue = issue({
  id: 33,
  due_date: "2026-09-20",
  estimated_hours: 8,
  updated_on: "2026-09-13T00:00:00Z",
});

const timeEntries: RedmineTimeEntry[] = [
  { id: 1, user: { id: 2, name: "佐藤" }, hours: 3.5, spent_on: TARGET_DATE, issue: { id: 20 } },
  // 対象外トラッカー（雑談）のチケットに対する工数
  { id: 2, user: { id: 1, name: "田中" }, hours: 4.25, spent_on: TARGET_DATE, issue: { id: 22 } },
  { id: 3, user: { id: 2, name: "佐藤" }, hours: 1.25, spent_on: TARGET_DATE, issue: { id: 20 } },
];

interface FakeClientState {
  journalFetches: number[];
}

function createFakeClient(state: FakeClientState): RedmineClient {
  const byId = new Map<number, RedmineIssue>(
    [newIssue, updatedIssue, descriptionOnlyIssue, overdueIssue, closedAfterTargetIssue, noEstimateIssue, notOverdueIssue].map(
      (i) => [i.id, i]
    )
  );

  return {
    listProjects: async () => projects,
    listTrackers: async () => trackers,
    listIssueStatuses: async () => statuses,
    listProjectMembers: async (projectId: number) => (projectId === 1 ? members : []),
    listTimeEntries: async (params: QueryParams) => (params.project_id === 1 ? timeEntries : []),
    getIssueWithJournals: async (id: number) => {
      state.journalFetches.push(id);
      const found = byId.get(id);
      if (!found) throw new Error(`unexpected issue: ${id}`);
      return found;
    },
    listIssues: async (params: QueryParams) => {
      if (params.issue_id) {
        // トラッカー絞り込み用の問い合わせ（チケットIDは一意なのでプロジェクト指定を伴わない）。
        // #22は対象外トラッカーなので返さない
        const ids = String(params.issue_id).split(",").map(Number);
        return [updatedIssue].filter((i) => ids.includes(i.id));
      }
      if (params.project_id !== 1) return [];
      if (typeof params.created_on === "string") return [newIssue];
      if (typeof params.updated_on === "string" && params.updated_on.startsWith("><")) {
        return [updatedIssue, descriptionOnlyIssue];
      }
      if (typeof params.updated_on === "string" && params.updated_on.startsWith(">=")) {
        return [closedAfterTargetIssue];
      }
      if (params.status_id === "open" && params.due_date) {
        return [overdueIssue, noEstimateIssue, notOverdueIssue];
      }
      return [];
    },
  } as unknown as RedmineClient;
}

describe("generateReport", () => {
  it("新規・更新・作業時間・遅延を集計する", async () => {
    const state: FakeClientState = { journalFetches: [] };
    const report = await generateReport({
      config,
      targetDate: TARGET_DATE,
      client: createFakeClient(state),
      now: NOW,
    });

    expect(report.status).toBe("success");
    expect(report.generatedAt).toBe("2026-09-15T06:00:03+09:00");

    expect(report.newIssues).toEqual([
      {
        id: 10,
        subject: "会員登録画面のレスポンシブ対応",
        author: "田中",
        tracker: "タスク",
        priority: "通常",
        assignee: "未アサイン",
        dueDate: null,
      },
    ]);

    // ステータス・担当者以外の変更しかないチケットは載らない
    expect(report.updatedIssues).toEqual([
      {
        id: 20,
        subject: "在庫連携バッチのエラー修正",
        changes: [{ field: "status", from: "新規", to: "進行中" }],
      },
    ]);

    // 対象外トラッカー（#22）の工数は除外し、合計は生の値で加算してから丸める
    expect(report.spentTime).toEqual([{ user: "佐藤", hours: 4.8 }]);
    expect(report.summary.totalSpentHours).toBe(4.8);

    expect(report.delayedIssues).toEqual([
      {
        id: 30,
        subject: "旧管理画面の廃止対応",
        assignee: "鈴木",
        dueDate: "2026-09-10",
        overdueDays: 4,
        estimatedHours: 10,
        doneRatio: 40,
        delayHours: 6,
      },
      {
        id: 31,
        subject: "顧客データ移行スクリプト",
        assignee: "佐藤",
        dueDate: "2026-09-08",
        overdueDays: 6,
        estimatedHours: 4,
        doneRatio: 20,
        delayHours: 3.2,
      },
    ]);
    expect(report.delayedUncalculableIssues).toEqual([
      {
        id: 32,
        subject: "旧システムのログ調査",
        assignee: "未アサイン",
        dueDate: "2026-09-12",
        overdueDays: 2,
      },
    ]);

    expect(report.summary).toEqual({
      newCount: 1,
      updatedCount: 1,
      totalSpentHours: 4.8,
      delayedCount: 3,
      delayedUncalculableCount: 1,
    });
  });

  it("対象日より後に更新されていない遅延候補ではjournalsを取得しない", async () => {
    const state: FakeClientState = { journalFetches: [] };
    await generateReport({ config, targetDate: TARGET_DATE, client: createFakeClient(state), now: NOW });

    // 更新チケット(#20,#21)と、対象日より後に更新された#31のみ個別取得する
    expect(state.journalFetches.sort()).toEqual([20, 21, 31]);
    expect(state.journalFetches).not.toContain(30);
  });

  it("対象プロジェクトが見つからない場合はConfigurationErrorを投げる", async () => {
    const state: FakeClientState = { journalFetches: [] };
    await expect(
      generateReport({
        config: { ...config, project: { identifier: "unknown", includeSubprojects: true } },
        targetDate: TARGET_DATE,
        client: createFakeClient(state),
        now: NOW,
      })
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("設定されたトラッカーが見つからない場合はConfigurationErrorを投げる", async () => {
    const state: FakeClientState = { journalFetches: [] };
    await expect(
      generateReport({
        config: { ...config, trackers: ["存在しないトラッカー"] },
        targetDate: TARGET_DATE,
        client: createFakeClient(state),
        now: NOW,
      })
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});
