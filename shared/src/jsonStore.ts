import * as fs from "node:fs";
import * as path from "node:path";
import lockfile from "proper-lockfile";

/** ファイルが存在しなければ初期値で作成する */
export async function ensureFile(filePath: string, initial: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
  } catch {
    await writeJsonAtomic(filePath, initial);
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

/** 一時ファイルに書いてからrenameすることで書き込みをアトミックにする */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.promises.rename(tmp, filePath);
}

/**
 * ファイルロックを取得したうえで read-modify-write を行う。
 * Web閲覧アプリ（常駐プロセス）とレポート生成バッチ（都度起動プロセス）が
 * 同じファイルへ同時に書き込んでも競合しないようにするための共通ヘルパー。
 */
export async function withFileLock<T>(
  filePath: string,
  initial: T,
  mutator: (current: T) => T | Promise<T>
): Promise<T> {
  await ensureFile(filePath, initial);
  const release = await lockfile.lock(filePath, {
    retries: { retries: 50, factor: 1.2, minTimeout: 20, maxTimeout: 150 },
    stale: 10000,
  });
  try {
    const current = await readJson<T>(filePath);
    const updated = await mutator(current);
    await writeJsonAtomic(filePath, updated);
    return updated;
  } finally {
    await release();
  }
}

export async function readWithDefault<T>(filePath: string, initial: T): Promise<T> {
  await ensureFile(filePath, initial);
  return readJson<T>(filePath);
}

/**
 * 指定したロックファイルを保持したまま処理を実行する。
 * レポート生成のように「ファイル更新以外の処理も含めてまるごと排他したい」場面で使う。
 * ロックを取得できない場合は onBusy を呼び出す（既定では例外を投げる）。
 */
export async function withLockFile<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: { retries?: number; staleMs?: number } = {}
): Promise<T> {
  await ensureFile(lockPath, {});
  const release = await lockfile.lock(lockPath, {
    retries: { retries: options.retries ?? 3, factor: 1.5, minTimeout: 100, maxTimeout: 800 },
    stale: options.staleMs ?? 300000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}
