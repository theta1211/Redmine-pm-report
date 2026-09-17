import axios, { AxiosInstance } from "axios";
import type { AppConfig } from "./types";
import { RedmineUnavailableError } from "./errors";

export interface RedmineRef {
  id: number;
  name: string;
}

export interface RedmineJournalDetail {
  property: string;
  name: string;
  old_value: string | null;
  new_value: string | null;
}

export interface RedmineJournal {
  id: number;
  created_on: string;
  details: RedmineJournalDetail[];
}

export interface RedmineIssue {
  id: number;
  subject: string;
  project?: RedmineRef;
  tracker?: RedmineRef;
  status?: RedmineRef & { is_closed?: boolean };
  priority?: RedmineRef;
  author?: RedmineRef;
  assigned_to?: RedmineRef;
  due_date?: string | null;
  done_ratio?: number;
  estimated_hours?: number | null;
  created_on: string;
  updated_on: string;
  journals?: RedmineJournal[];
}

export interface RedmineTimeEntry {
  id: number;
  user: RedmineRef;
  hours: number;
  spent_on: string;
  issue?: { id: number };
}

export interface RedmineStatus {
  id: number;
  name: string;
  is_closed?: boolean;
}

export interface RedmineTracker {
  id: number;
  name: string;
}

export interface RedmineProject {
  id: number;
  name: string;
  identifier: string;
  parent?: { id: number };
}

export type QueryParams = Record<string, string | number | undefined>;

const PAGE_SIZE = 100;

export function createRedmineClient(config: AppConfig["redmine"]) {
  const http: AxiosInstance = axios.create({
    baseURL: config.url,
    headers: { "X-Redmine-API-Key": config.apiKey },
    timeout: 30000,
  });

  async function get<T>(pathname: string, params?: QueryParams): Promise<T> {
    try {
      const res = await http.get<T>(pathname, { params });
      return res.data;
    } catch (err) {
      throw new RedmineUnavailableError(
        `Redmineへの接続に失敗しました（${pathname}）: ${(err as Error).message}`
      );
    }
  }

  /**
   * 一覧系エンドポイントは既定25件・最大100件しか返さないため、
   * total_countに達するまでoffsetを進めて全件を取得する。
   */
  async function fetchAll<T>(pathname: string, key: string, params: QueryParams = {}): Promise<T[]> {
    const collected: T[] = [];
    let offset = 0;
    for (;;) {
      const page = await get<Record<string, unknown>>(pathname, {
        ...params,
        limit: PAGE_SIZE,
        offset,
      });
      const items = (page[key] as T[] | undefined) ?? [];
      collected.push(...items);
      const totalCount = Number(page.total_count ?? collected.length);
      offset += PAGE_SIZE;
      if (items.length === 0 || collected.length >= totalCount) break;
    }
    return collected;
  }

  return {
    listIssues(params: QueryParams): Promise<RedmineIssue[]> {
      return fetchAll<RedmineIssue>("/issues.json", "issues", params);
    },

    /** journalsは単一チケット取得でのみ取得できる（一覧APIのincludeでは取得できない） */
    async getIssueWithJournals(id: number): Promise<RedmineIssue> {
      const data = await get<{ issue: RedmineIssue }>(`/issues/${id}.json`, { include: "journals" });
      return data.issue;
    },

    listTimeEntries(params: QueryParams): Promise<RedmineTimeEntry[]> {
      return fetchAll<RedmineTimeEntry>("/time_entries.json", "time_entries", params);
    },

    async listTrackers(): Promise<RedmineTracker[]> {
      const data = await get<{ trackers: RedmineTracker[] }>("/trackers.json");
      return data.trackers ?? [];
    },

    async listIssueStatuses(): Promise<RedmineStatus[]> {
      const data = await get<{ issue_statuses: RedmineStatus[] }>("/issue_statuses.json");
      return data.issue_statuses ?? [];
    },

    listProjects(): Promise<RedmineProject[]> {
      return fetchAll<RedmineProject>("/projects.json", "projects");
    },

    async listProjectMembers(projectId: number): Promise<RedmineRef[]> {
      const memberships = await fetchAll<{ user?: RedmineRef }>(
        `/projects/${projectId}/memberships.json`,
        "memberships"
      );
      return memberships.map((m) => m.user).filter((u): u is RedmineRef => !!u);
    },
  };
}

export type RedmineClient = ReturnType<typeof createRedmineClient>;

/** 対象プロジェクトと（設定に応じて）その子孫プロジェクトのIDを解決する */
export function resolveProjectIds(
  projects: RedmineProject[],
  identifier: string,
  includeSubprojects: boolean
): number[] {
  const target = projects.find(
    (p) => p.identifier === identifier || String(p.id) === String(identifier)
  );
  if (!target) return [];
  if (!includeSubprojects) return [target.id];

  const ids = [target.id];
  // 親子関係は複数階層になりうるため、追加がなくなるまで子を辿る
  for (;;) {
    const children = projects.filter((p) => p.parent && ids.includes(p.parent.id) && !ids.includes(p.id));
    if (children.length === 0) break;
    ids.push(...children.map((c) => c.id));
  }
  return ids;
}

export function resolveTrackerIds(trackers: RedmineTracker[], names: string[]): number[] {
  return names
    .map((name) => trackers.find((t) => t.name === name))
    .filter((t): t is RedmineTracker => !!t)
    .map((t) => t.id);
}
