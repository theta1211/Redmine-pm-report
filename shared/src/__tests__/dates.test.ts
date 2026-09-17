import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  eachDate,
  isBusinessDay,
  isValidDateString,
  jstDayEndUtc,
  jstDayStartUtc,
  previousBusinessDay,
  toJstIsoString,
  toRunId,
  todayInJst,
} from "../dates";

describe("previousBusinessDay", () => {
  it("火〜金の起動では前日を対象日にする", () => {
    // 2026-09-15は火曜日
    expect(previousBusinessDay("2026-09-15")).toBe("2026-09-14");
    expect(previousBusinessDay("2026-09-18")).toBe("2026-09-17");
  });

  it("月曜日の起動では前週金曜日を対象日にする（土日をスキップする）", () => {
    // 2026-09-14は月曜日、前日は日曜日
    expect(previousBusinessDay("2026-09-14")).toBe("2026-09-11");
  });

  it("土曜・日曜に起動した場合も直前の平日を返す", () => {
    expect(previousBusinessDay("2026-09-12")).toBe("2026-09-11");
    expect(previousBusinessDay("2026-09-13")).toBe("2026-09-11");
  });
});

describe("isBusinessDay", () => {
  it("月〜金のみ営業日とする", () => {
    expect(isBusinessDay("2026-09-14")).toBe(true);
    expect(isBusinessDay("2026-09-11")).toBe(true);
    expect(isBusinessDay("2026-09-12")).toBe(false);
    expect(isBusinessDay("2026-09-13")).toBe(false);
  });
});

describe("JSTの日付境界", () => {
  it("JSTの0:00と23:59:59をUTC表記で返す", () => {
    expect(jstDayStartUtc("2026-09-14")).toBe("2026-09-13T15:00:00Z");
    expect(jstDayEndUtc("2026-09-14")).toBe("2026-09-14T14:59:59Z");
  });

  it("UTCでは前日でもJSTの日付を返す", () => {
    expect(todayInJst(new Date("2026-09-14T15:30:00Z"))).toBe("2026-09-15");
    expect(todayInJst(new Date("2026-09-14T14:30:00Z"))).toBe("2026-09-14");
  });

  it("JSTオフセット付きのISO文字列とrunIdを生成する", () => {
    expect(toJstIsoString(new Date("2026-09-14T21:00:03Z"))).toBe("2026-09-15T06:00:03+09:00");
    expect(toRunId(new Date("2026-09-14T21:00:03Z"))).toBe("20260915-060003");
  });
});

describe("日付ユーティリティ", () => {
  it("加算・差分・列挙ができる", () => {
    expect(addDays("2026-09-14", -1)).toBe("2026-09-13");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(diffDays("2026-09-14", "2026-09-10")).toBe(4);
    expect(eachDate("2026-09-13", "2026-09-15")).toEqual(["2026-09-13", "2026-09-14", "2026-09-15"]);
  });

  it("不正な日付を弾く", () => {
    expect(isValidDateString("2026-09-14")).toBe(true);
    expect(isValidDateString("2026-9-14")).toBe(false);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("export")).toBe(false);
  });
});
