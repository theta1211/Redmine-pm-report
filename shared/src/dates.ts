/**
 * 日付は "YYYY-MM-DD" の文字列として扱い、内部計算にはUTC正午ではなくUTC 0時のDateを使う。
 * 実行マシンのタイムゾーン設定に結果が左右されないようにするため、
 * Dateのローカル系メソッド（getFullYear等）は使用しない。
 */

const MS_PER_DAY = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && formatDate(parsed) === value;
}

export function parseDate(date: string): Date {
  if (!isValidDateString(date)) {
    throw new Error(`日付の形式が不正です: ${date}`);
  }
  return new Date(`${date}T00:00:00Z`);
}

export function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return formatDate(new Date(parseDate(date).getTime() + days * MS_PER_DAY));
}

/** a - b を日数で返す */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / MS_PER_DAY);
}

/** 0=日曜, 1=月曜, ... 6=土曜 */
export function dayOfWeek(date: string): number {
  return parseDate(date).getUTCDay();
}

/** 月〜金を営業日とする（祝日は考慮しない） */
export function isBusinessDay(date: string): boolean {
  const day = dayOfWeek(date);
  return day >= 1 && day <= 5;
}

/**
 * 指定日の直前の営業日を返す。
 * 単純な「前日」では月曜日の対象日が日曜日になってしまうため、
 * 土日を遡って最初に見つかった平日を採用する（月曜起動なら前週金曜日）。
 */
export function previousBusinessDay(date: string): string {
  let candidate = addDays(date, -1);
  while (!isBusinessDay(candidate)) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

/** 現在時刻（UTC基準のDate）からJSTでの「今日」を求める */
export function todayInJst(now: Date = new Date()): string {
  return formatDate(new Date(now.getTime() + JST_OFFSET_MS));
}

/** JSTでの当日0:00をUTC表記のISO文字列で返す（例: 2026-09-14 → 2026-09-13T15:00:00Z） */
export function jstDayStartUtc(date: string): string {
  return new Date(parseDate(date).getTime() - JST_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** JSTでの当日23:59:59をUTC表記のISO文字列で返す */
export function jstDayEndUtc(date: string): string {
  const end = parseDate(date).getTime() + MS_PER_DAY - 1000 - JST_OFFSET_MS;
  return new Date(end).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** JST基準のISO 8601文字列を返す（例: 2026-09-15T06:00:03+09:00） */
export function toJstIsoString(value: Date = new Date()): string {
  const shifted = new Date(value.getTime() + JST_OFFSET_MS);
  return `${shifted.toISOString().replace(/\.\d{3}Z$/, "")}+09:00`;
}

/** 実行履歴のrunId（JST基準のyyyyMMdd-HHmmss） */
export function toRunId(value: Date = new Date()): string {
  const iso = toJstIsoString(value);
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

/** fromからtoまでの日付を昇順で列挙する（両端を含む） */
export function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  let current = from;
  while (diffDays(to, current) >= 0) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}
