import type { RedmineIssue, RedmineJournal } from "./redmineClient";

/** 巻き戻し対象とするフィールド（Redmineのjournal detail上の属性名） */
const TRACKED_ATTRS = ["status_id", "assigned_to_id", "due_date", "done_ratio", "estimated_hours"] as const;

export interface IssueSnapshot {
  statusId: number | null;
  assigneeId: number | null;
  dueDate: string | null;
  doneRatio: number;
  estimatedHours: number | null;
}

export function currentSnapshot(issue: RedmineIssue): IssueSnapshot {
  return {
    statusId: issue.status?.id ?? null,
    assigneeId: issue.assigned_to?.id ?? null,
    dueDate: issue.due_date ?? null,
    doneRatio: issue.done_ratio ?? 0,
    estimatedHours: issue.estimated_hours ?? null,
  };
}

function toNumberOrNull(value: string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyOldValue(snapshot: IssueSnapshot, name: string, oldValue: string | null): void {
  switch (name) {
    case "status_id":
      snapshot.statusId = toNumberOrNull(oldValue);
      break;
    case "assigned_to_id":
      snapshot.assigneeId = toNumberOrNull(oldValue);
      break;
    case "due_date":
      snapshot.dueDate = oldValue && oldValue !== "" ? oldValue : null;
      break;
    case "done_ratio":
      snapshot.doneRatio = toNumberOrNull(oldValue) ?? 0;
      break;
    case "estimated_hours":
      snapshot.estimatedHours = toNumberOrNull(oldValue);
      break;
    default:
      break;
  }
}

function sortedJournals(issue: RedmineIssue): RedmineJournal[] {
  return [...(issue.journals ?? [])].sort((a, b) => {
    if (a.created_on === b.created_on) return a.id - b.id;
    return a.created_on < b.created_on ? -1 : 1;
  });
}

/**
 * 現在値を起点に、cutoff（対象日の終端、UTC表記のISO文字列）より後のjournalを
 * 新しい順に打ち消して、対象日時点のスナップショットを復元する。
 * 初期値から順方向に適用するのではなく巻き戻すことで、チケット作成時の値を別途取得せずに済む。
 */
export function snapshotAt(issue: RedmineIssue, cutoffIso: string): IssueSnapshot {
  const snapshot = currentSnapshot(issue);
  const laterJournals = sortedJournals(issue).filter((j) => j.created_on > cutoffIso);
  for (const journal of laterJournals.reverse()) {
    for (const detail of journal.details ?? []) {
      if (detail.property !== "attr") continue;
      if (!TRACKED_ATTRS.includes(detail.name as (typeof TRACKED_ATTRS)[number])) continue;
      applyOldValue(snapshot, detail.name, detail.old_value);
    }
  }
  return snapshot;
}

export interface RawIssueChange {
  field: "status" | "assignee";
  fromId: number | null;
  toId: number | null;
}

/**
 * 対象日（fromIso〜toIso）のjournalから、ステータス・担当者の変更のみを時系列順に抽出する。
 * updated_onは他フィールドの変更でも更新されるため、対象フィールドが実際に変わったものだけを拾う。
 */
export function extractChangesInRange(
  issue: RedmineIssue,
  fromIso: string,
  toIso: string
): RawIssueChange[] {
  const changes: RawIssueChange[] = [];
  for (const journal of sortedJournals(issue)) {
    if (journal.created_on < fromIso || journal.created_on > toIso) continue;
    for (const detail of journal.details ?? []) {
      if (detail.property !== "attr") continue;
      if (detail.name === "status_id") {
        changes.push({
          field: "status",
          fromId: toNumberOrNull(detail.old_value),
          toId: toNumberOrNull(detail.new_value),
        });
      } else if (detail.name === "assigned_to_id") {
        changes.push({
          field: "assignee",
          fromId: toNumberOrNull(detail.old_value),
          toId: toNumberOrNull(detail.new_value),
        });
      }
    }
  }
  return changes;
}
