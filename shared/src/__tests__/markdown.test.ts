import { describe, expect, it } from "vitest";
import { renderRangeMarkdown, renderReportMarkdown } from "../markdown";
import type { SuccessReport } from "../types";

function successReport(overrides: Partial<SuccessReport> = {}): SuccessReport {
  return {
    targetDate: "2026-09-14",
    status: "success",
    generatedAt: "2026-09-15T06:00:03+09:00",
    summary: {
      newCount: 1,
      updatedCount: 1,
      totalSpentHours: 7.5,
      delayedCount: 2,
      delayedUncalculableCount: 1,
    },
    newIssues: [
      {
        id: 10,
        subject: "会員登録画面の対応",
        author: "田中",
        tracker: "タスク",
        priority: "通常",
        assignee: "未アサイン",
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
    delayedUncalculableIssues: [
      { id: 32, subject: "ログ調査", assignee: "佐藤", dueDate: "2026-09-12", overdueDays: 2 },
    ],
    errorMessage: null,
    ...overrides,
  };
}

describe("renderReportMarkdown", () => {
  it("サマリと各セクションを出力する", () => {
    const markdown = renderReportMarkdown(successReport());

    expect(markdown).toContain("# 日次レポート 2026-09-14");
    expect(markdown).toContain("- 新規登録: 1件");
    expect(markdown).toContain("- 作業時間合計: 7.5h");
    expect(markdown).toContain("- 遅延: 2件（うち計算不可 1件）");
    expect(markdown).toContain("| #10 | 会員登録画面の対応 | 田中 | タスク | 通常 | 未アサイン | 2026-09-20 |");
    expect(markdown).toContain("ステータス: 新規 → 進行中");
    expect(markdown).toContain("| 佐藤 | 7.5h |");
    expect(markdown).toContain("### 計算不可（工数未設定）");
  });

  it("件数0のセクションは該当なしと出力する", () => {
    const markdown = renderReportMarkdown(
      successReport({
        newIssues: [],
        updatedIssues: [],
        spentTime: [],
        delayedIssues: [],
        delayedUncalculableIssues: [],
      })
    );

    expect(markdown).toContain("該当なし");
    expect(markdown).not.toContain("### 計算不可（工数未設定）");
  });

  it("件名中のパイプをエスケープする", () => {
    const markdown = renderReportMarkdown(
      successReport({
        newIssues: [
          {
            id: 11,
            subject: "A|B の切り替え",
            author: "田中",
            tracker: "タスク",
            priority: "通常",
            assignee: "佐藤",
            dueDate: null,
          },
        ],
      })
    );

    expect(markdown).toContain("A\\|B の切り替え");
  });

  it("生成失敗のレポートはエラーメッセージのみ出力する", () => {
    const markdown = renderReportMarkdown({
      targetDate: "2026-09-11",
      status: "failed",
      generatedAt: "2026-09-12T06:00:04+09:00",
      errorMessage: "Redmineへの接続に失敗しました",
    });

    expect(markdown).toContain("レポートの生成に失敗しました: Redmineへの接続に失敗しました");
    expect(markdown).not.toContain("サマリ");
  });
});

describe("renderRangeMarkdown", () => {
  it("期間サマリと日ごとの詳細、対象外の日付を出力する", () => {
    const markdown = renderRangeMarkdown({
      from: "2026-09-11",
      to: "2026-09-15",
      reports: [
        successReport({ targetDate: "2026-09-11" }),
        successReport({
          targetDate: "2026-09-15",
          summary: {
            newCount: 2,
            updatedCount: 3,
            totalSpentHours: 4.25,
            delayedCount: 1,
            delayedUncalculableCount: 0,
          },
        }),
      ],
      missingDates: ["2026-09-14"],
    });

    expect(markdown).toContain("# 日次レポート 2026-09-11 〜 2026-09-15");
    expect(markdown).toContain("- 対象レポート: 2日分");
    expect(markdown).toContain("- 新規登録 合計: 3件");
    expect(markdown).toContain("- 作業時間 合計: 11.8h");
    // 遅延は期間内で最も新しい対象日のスナップショットを使う
    expect(markdown).toContain("- 遅延（2026-09-15時点）: 1件（うち計算不可 0件）");
    expect(markdown).toContain("## 日次レポート 2026-09-11");
    expect(markdown).toContain("- 2026-09-14（レポートなし、または生成失敗）");
  });
});
