import * as fs from "node:fs";
import * as path from "node:path";
import type { AppConfig } from "./types";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

let cached: AppConfig | undefined;

/**
 * config/config.json を読み込む。存在しない場合はエラーにせず、
 * ローカル開発・テストが継続できるよう安全な既定値を返す。
 */
export function loadConfig(configPath?: string): AppConfig {
  if (cached && !configPath) return cached;

  const resolvedPath =
    configPath ?? process.env.PMREPORT_CONFIG_PATH ?? path.join(REPO_ROOT, "config", "config.json");
  let loaded: Partial<AppConfig> = {};
  if (fs.existsSync(resolvedPath)) {
    loaded = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
  }

  const config: AppConfig = {
    redmine: {
      url: loaded.redmine?.url ?? "",
      apiKey: loaded.redmine?.apiKey ?? "",
    },
    project: {
      identifier: loaded.project?.identifier ?? "",
      includeSubprojects: loaded.project?.includeSubprojects ?? true,
    },
    trackers: loaded.trackers ?? [],
    retentionDays: loaded.retentionDays ?? 90,
    export: {
      maxRangeDays: loaded.export?.maxRangeDays ?? 31,
    },
    // 相対パスで指定された場合もプロセスのcwdに依存しないよう、リポジトリルート基準で解決する
    dataDir: loaded.dataDir ? path.resolve(REPO_ROOT, loaded.dataDir) : path.join(REPO_ROOT, "data"),
  };

  if (!configPath) cached = config;
  return config;
}

export function resetConfigCacheForTests(): void {
  cached = undefined;
}

export function repoRoot(): string {
  return REPO_ROOT;
}
