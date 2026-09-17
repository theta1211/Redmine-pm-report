import { addDays, diffDays, jstDayEndUtc, jstDayStartUtc, toJstIsoString } from "./dates";
import { ConfigurationError } from "./errors";
import { currentSnapshot, extractChangesInRange, snapshotAt } from "./issueState";
import {
  createRedmineClient,
  resolveProjectIds,
  resolveTrackerIds,
  type QueryParams,
  type RedmineClient,
  type RedmineIssue,
  type RedmineTimeEntry,
} from "./redmineClient";
import type {
  AppConfig,
  DelayedIssue,
  DelayedUncalculableIssue,
  NewIssue,
  SpentTimeEntry,
  SuccessReport,
  UpdatedIssue,
} from "./types";

const UNASSIGNED = "未アサイン";
const EMPTY_VALUE = "（なし）";
const ISSUE_ID_CHUNK_SIZE = 100;

export interface GenerateReportOptions {
  config: AppConfig;
  targetDate: string;
  client?: RedmineClient;
  now?: Date;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * 対象日のレポートを生成する。
 * Redmineへの接続失敗や設定不備は例外として送出し、呼び出し側で「生成失敗」として記録する。
 */
export async function generateReport(options: GenerateReportOptions): Promise<SuccessReport> {
  const { config, targetDate } = options;
  const client = options.client ?? createRedmineClient(config.redmine);
  const dayStart = jstDayStartUtc(targetDate);
  const dayEnd = jstDayEndUtc(targetDate);

  const [projects, trackers, statuses] = await Promise.all([
    client.listProjects(),
    client.listTrackers(),
    client.listIssueStatuses(),
  ]);

  const projectIds = resolveProjectIds(
    projects,
    config.project.identifier,
    config.project.includeSubprojects
  );
  if (projectIds.length === 0) {
    throw new ConfigurationError(
      `対象プロジェクトがRedmine上に見つかりません: ${config.project.identifier}`
    );
  }

  const trackerIds = resolveTrackerIds(trackers, config.trackers);
  if (config.trackers.length > 0 && trackerIds.length === 0) {
    throw new ConfigurationError(
      `設定された集計対象トラッカーがRedmine上に見つかりません: ${config.trackers.join(", ")}`
    );
  }
  const trackerFilter = trackerIds.length > 0 ? trackerIds.join(",") : undefined;

  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const userNameById = new Map<number, string>();
  for (const projectId of projectIds) {
    for (const member of await client.listProjectMembers(projectId)) {
      userNameById.set(member.id, member.name);
    }
  }

  const rememberUsers = (issues: RedmineIssue[]): void => {
    for (const issue of issues) {
      if (issue.assigned_to) userNameById.set(issue.assigned_to.id, issue.assigned_to.name);
      if (issue.author) userNameById.set(issue.author.id, issue.author.name);
    }
  };

  const statusName = (id: number | null): string => {
    if (id === null) return EMPTY_VALUE;
    return statusById.get(id)?.name ?? `#${id}`;
  };
  const userName = (id: number | null): string => {
    if (id === null) return UNASSIGNED;
    return userNameById.get(id) ?? `#${id}`;
  };

  /**
   * プロジェクトごとに問い合わせて結果をマージする。
   * サブプロジェクトは呼び出し側で明示的に展開しているため、各クエリでは subproject_id=!* を付けて
   * Redmineのバージョン差（project_id指定時にサブプロジェクトを含むか）に依存しないようにする。
   */
  const listIssuesForProjects = async (params: QueryParams): Promise<RedmineIssue[]> => {
    const byId = new Map<number, RedmineIssue>();
    for (const projectId of projectIds) {
      const issues = await client.listIssues({
        project_id: projectId,
        subproject_id: "!*",
        ...(trackerFilter ? { tracker_id: trackerFilter } : {}),
        ...params,
      });
      for (const issue of issues) byId.set(issue.id, issue);
    }
    const merged = [...byId.values()];
    rememberUsers(merged);
    return merged;
  };

  // 1. 新規登録チケット
  const newIssueRecords = await listIssuesForProjects({
    status_id: "*",
    created_on: `><${dayStart}|${dayEnd}`,
  });
  const newIssues: NewIssue[] = newIssueRecords
    .sort((a, b) => a.id - b.id)
    .map((issue) => ({
      id: issue.id,
      subject: issue.subject,
      author: issue.author?.name ?? EMPTY_VALUE,
      tracker: issue.tracker?.name ?? EMPTY_VALUE,
      priority: issue.priority?.name ?? EMPTY_VALUE,
      assignee: issue.assigned_to?.name ?? UNASSIGNED,
      dueDate: issue.due_date ?? null,
    }));

  // 2. 更新チケット（ステータス・担当者の変更のみ）
  const updatedCandidates = await listIssuesForProjects({
    status_id: "*",
    updated_on: `><${dayStart}|${dayEnd}`,
  });
  const updatedIssues: UpdatedIssue[] = [];
  for (const candidate of updatedCandidates.sort((a, b) => a.id - b.id)) {
    const issue = await client.getIssueWithJournals(candidate.id);
    rememberUsers([issue]);
    const rawChanges = extractChangesInRange(issue, dayStart, dayEnd);
    if (rawChanges.length === 0) continue;
    updatedIssues.push({
      id: candidate.id,
      subject: issue.subject ?? candidate.subject,
      changes: rawChanges.map((change) => ({
        field: change.field,
        from: change.field === "status" ? statusName(change.fromId) : userName(change.fromId),
        to: change.field === "status" ? statusName(change.toId) : userName(change.toId),
      })),
    });
  }

  // 3. 作業時間（入力者別）
  const timeEntriesById = new Map<number, RedmineTimeEntry>();
  for (const projectId of projectIds) {
    const entries = await client.listTimeEntries({ project_id: projectId, spent_on: targetDate });
    for (const entry of entries) timeEntriesById.set(entry.id, entry);
  }
  let timeEntries = [...timeEntriesById.values()];
  if (trackerFilter) {
    // time_entriesはトラッカーで絞り込めないため、紐づくチケットのトラッカーを引いて絞り込む。
    // チケットに紐づかない（プロジェクト単位の）作業時間はトラッカーを判定できないため対象外とする。
    const issueIds = [...new Set(timeEntries.map((e) => e.issue?.id).filter((id): id is number => !!id))];
    const allowedIssueIds = new Set<number>();
    for (const ids of chunk(issueIds, ISSUE_ID_CHUNK_SIZE)) {
      const issues = await client.listIssues({
        issue_id: ids.join(","),
        status_id: "*",
        tracker_id: trackerFilter,
      });
      for (const issue of issues) allowedIssueIds.add(issue.id);
    }
    timeEntries = timeEntries.filter((entry) => entry.issue && allowedIssueIds.has(entry.issue.id));
  }
  const hoursByUser = new Map<string, number>();
  for (const entry of timeEntries) {
    const name = entry.user?.name ?? EMPTY_VALUE;
    hoursByUser.set(name, (hoursByUser.get(name) ?? 0) + entry.hours);
  }
  // 合計は生の値で加算し、表示単位（小数点1桁）への丸めは最後に行う
  const totalSpentHours = round1([...hoursByUser.values()].reduce((sum, hours) => sum + hours, 0));
  const spentTime: SpentTimeEntry[] = [...hoursByUser.entries()]
    .map(([user, hours]) => ({ user, hours: round1(hours) }))
    .sort((a, b) => (b.hours === a.hours ? a.user.localeCompare(b.user) : b.hours - a.hours));

  // 4. 遅延・期限超過チケット（対象日時点の状態を復元して判定）
  const candidatesById = new Map<number, RedmineIssue>();
  for (const issue of await listIssuesForProjects({
    status_id: "open",
    due_date: `<=${addDays(targetDate, -1)}`,
  })) {
    candidatesById.set(issue.id, issue);
  }
  for (const issue of await listIssuesForProjects({
    status_id: "*",
    updated_on: `>=${jstDayStartUtc(addDays(targetDate, 1))}`,
  })) {
    candidatesById.set(issue.id, issue);
  }

  const delayedIssues: DelayedIssue[] = [];
  const delayedUncalculableIssues: DelayedUncalculableIssue[] = [];
  for (const candidate of candidatesById.values()) {
    // 対象日より後に更新されていないチケットは現在値がそのまま対象日時点の状態になる
    const snapshot =
      candidate.updated_on > dayEnd
        ? snapshotAt(await client.getIssueWithJournals(candidate.id), dayEnd)
        : currentSnapshot(candidate);

    if (!snapshot.dueDate) continue;
    const overdueDays = diffDays(targetDate, snapshot.dueDate);
    if (overdueDays <= 0) continue;
    const status = snapshot.statusId !== null ? statusById.get(snapshot.statusId) : undefined;
    if (status?.is_closed) continue;

    const assignee = userName(snapshot.assigneeId);
    if (snapshot.estimatedHours === null) {
      delayedUncalculableIssues.push({
        id: candidate.id,
        subject: candidate.subject,
        assignee,
        dueDate: snapshot.dueDate,
        overdueDays,
      });
      continue;
    }
    delayedIssues.push({
      id: candidate.id,
      subject: candidate.subject,
      assignee,
      dueDate: snapshot.dueDate,
      overdueDays,
      estimatedHours: snapshot.estimatedHours,
      doneRatio: snapshot.doneRatio,
      delayHours: round1(snapshot.estimatedHours * (1 - snapshot.doneRatio / 100)),
    });
  }
  delayedIssues.sort((a, b) => (b.delayHours === a.delayHours ? a.id - b.id : b.delayHours - a.delayHours));
  delayedUncalculableIssues.sort((a, b) =>
    b.overdueDays === a.overdueDays ? a.id - b.id : b.overdueDays - a.overdueDays
  );

  return {
    targetDate,
    status: "success",
    generatedAt: toJstIsoString(options.now ?? new Date()),
    summary: {
      newCount: newIssues.length,
      updatedCount: updatedIssues.length,
      totalSpentHours,
      delayedCount: delayedIssues.length + delayedUncalculableIssues.length,
      delayedUncalculableCount: delayedUncalculableIssues.length,
    },
    newIssues,
    updatedIssues,
    spentTime,
    delayedIssues,
    delayedUncalculableIssues,
    errorMessage: null,
  };
}
