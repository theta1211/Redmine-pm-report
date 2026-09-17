import * as path from "node:path";
import { diffDays } from "./dates";
import { readWithDefault, withFileLock } from "./jsonStore";
import type { AppConfig, RunHistory, RunHistoryEntry } from "./types";

const EMPTY_HISTORY: RunHistory = { items: [] };

export function runHistoryPath(config: AppConfig): string {
  return path.join(config.dataDir, "run-history.json");
}

export async function appendRunHistory(config: AppConfig, entry: RunHistoryEntry): Promise<void> {
  await withFileLock<RunHistory>(runHistoryPath(config), EMPTY_HISTORY, (current) => ({
    items: [...current.items, entry],
  }));
}

/** 実行日時の降順で返す */
export async function listRunHistory(config: AppConfig): Promise<RunHistoryEntry[]> {
  const history = await readWithDefault<RunHistory>(runHistoryPath(config), EMPTY_HISTORY);
  return [...history.items].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/** 対象日が保持期間より前になった実行履歴を削除し、削除件数を返す */
export async function cleanupRunHistory(config: AppConfig, today: string): Promise<number> {
  let removed = 0;
  await withFileLock<RunHistory>(runHistoryPath(config), EMPTY_HISTORY, (current) => {
    const items = current.items.filter((item) => diffDays(today, item.targetDate) < config.retentionDays);
    removed = current.items.length - items.length;
    return { items };
  });
  return removed;
}
