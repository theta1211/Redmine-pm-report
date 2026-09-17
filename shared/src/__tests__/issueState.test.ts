import { describe, expect, it } from "vitest";
import { currentSnapshot, extractChangesInRange, snapshotAt } from "../issueState";
import type { RedmineIssue } from "../redmineClient";

const CUTOFF = "2026-09-14T14:59:59Z"; // JST 2026-09-14 23:59:59

function issue(overrides: Partial<RedmineIssue> = {}): RedmineIssue {
  return {
    id: 100,
    subject: "テストチケット",
    status: { id: 5, name: "完了", is_closed: true },
    assigned_to: { id: 2, name: "佐藤" },
    due_date: "2026-09-20",
    done_ratio: 100,
    estimated_hours: 12,
    created_on: "2026-09-01T00:00:00Z",
    updated_on: "2026-09-15T01:00:00Z",
    ...overrides,
  };
}

describe("snapshotAt", () => {
  it("対象日より後のjournalを巻き戻して対象日時点の状態を復元する", () => {
    const target = issue({
      journals: [
        {
          id: 1,
          created_on: "2026-09-15T01:00:00Z",
          details: [
            { property: "attr", name: "status_id", old_value: "2", new_value: "5" },
            { property: "attr", name: "done_ratio", old_value: "40", new_value: "100" },
            { property: "attr", name: "assigned_to_id", old_value: "3", new_value: "2" },
          ],
        },
      ],
    });

    expect(snapshotAt(target, CUTOFF)).toEqual({
      statusId: 2,
      assigneeId: 3,
      dueDate: "2026-09-20",
      doneRatio: 40,
      estimatedHours: 12,
    });
  });

  it("複数journalがある場合は最も古い変更前の値まで巻き戻す", () => {
    const target = issue({
      journals: [
        {
          id: 1,
          created_on: "2026-09-15T01:00:00Z",
          details: [{ property: "attr", name: "done_ratio", old_value: "40", new_value: "70" }],
        },
        {
          id: 2,
          created_on: "2026-09-16T02:00:00Z",
          details: [{ property: "attr", name: "done_ratio", old_value: "70", new_value: "100" }],
        },
      ],
    });

    expect(snapshotAt(target, CUTOFF).doneRatio).toBe(40);
  });

  it("対象日以前のjournalは巻き戻さない", () => {
    const target = issue({
      done_ratio: 60,
      journals: [
        {
          id: 1,
          created_on: "2026-09-14T03:00:00Z",
          details: [{ property: "attr", name: "done_ratio", old_value: "10", new_value: "60" }],
        },
      ],
    });

    expect(snapshotAt(target, CUTOFF).doneRatio).toBe(60);
  });

  it("attr以外の変更（コメント添付など）は無視する", () => {
    const target = issue({
      journals: [
        {
          id: 1,
          created_on: "2026-09-15T01:00:00Z",
          details: [{ property: "attachment", name: "1", old_value: null, new_value: "spec.pdf" }],
        },
      ],
    });

    expect(snapshotAt(target, CUTOFF)).toEqual(currentSnapshot(target));
  });

  it("未設定へ巻き戻る場合はnullになる", () => {
    const target = issue({
      journals: [
        {
          id: 1,
          created_on: "2026-09-15T01:00:00Z",
          details: [
            { property: "attr", name: "estimated_hours", old_value: null, new_value: "12" },
            { property: "attr", name: "due_date", old_value: "", new_value: "2026-09-20" },
          ],
        },
      ],
    });

    const snapshot = snapshotAt(target, CUTOFF);
    expect(snapshot.estimatedHours).toBeNull();
    expect(snapshot.dueDate).toBeNull();
  });
});

describe("extractChangesInRange", () => {
  const from = "2026-09-13T15:00:00Z";
  const to = "2026-09-14T14:59:59Z";

  it("対象日のステータス・担当者変更のみを時系列順に抽出する", () => {
    const target = issue({
      journals: [
        {
          id: 1,
          created_on: "2026-09-12T01:00:00Z",
          details: [{ property: "attr", name: "status_id", old_value: "1", new_value: "2" }],
        },
        {
          id: 2,
          created_on: "2026-09-14T02:00:00Z",
          details: [
            { property: "attr", name: "status_id", old_value: "2", new_value: "3" },
            { property: "attr", name: "priority_id", old_value: "4", new_value: "5" },
          ],
        },
        {
          id: 3,
          created_on: "2026-09-14T05:00:00Z",
          details: [{ property: "attr", name: "assigned_to_id", old_value: null, new_value: "7" }],
        },
      ],
    });

    expect(extractChangesInRange(target, from, to)).toEqual([
      { field: "status", fromId: 2, toId: 3 },
      { field: "assignee", fromId: null, toId: 7 },
    ]);
  });

  it("対象フィールドの変更がなければ空配列を返す", () => {
    const target = issue({
      journals: [
        {
          id: 1,
          created_on: "2026-09-14T02:00:00Z",
          details: [{ property: "attr", name: "description", old_value: "a", new_value: "b" }],
        },
      ],
    });

    expect(extractChangesInRange(target, from, to)).toEqual([]);
  });
});
