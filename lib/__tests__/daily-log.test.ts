import { describe, it, expect } from "vitest";
import {
  normalizeLogPhotos,
  sameLocalDate,
  parseWeather,
  serializeWeather,
  formatWeatherSummary,
  buildReportNumber,
  computeManpowerByCase,
  computeDayLaborByCase,
  computeSubcontractorTotalsByCase,
  isBackfilledLog,
  todayLocalDate,
} from "../daily-log";

describe("normalizeLogPhotos", () => {
  it("accepts legacy string[] format", () => {
    const out = normalizeLogPhotos(["a/1.jpg", "b/2.jpg"]);
    expect(out).toEqual([
      { path: "a/1.jpg", caption: "" },
      { path: "b/2.jpg", caption: "" },
    ]);
  });

  it("accepts new {path, caption} format", () => {
    const out = normalizeLogPhotos([
      { path: "a/1.jpg", caption: "工地照" },
      { path: "b/2.jpg", caption: "" },
    ]);
    expect(out).toEqual([
      { path: "a/1.jpg", caption: "工地照" },
      { path: "b/2.jpg", caption: "" },
    ]);
  });

  it("filters out malformed entries", () => {
    const out = normalizeLogPhotos([
      "valid.jpg",
      null,
      undefined,
      { caption: "no path" },
      { path: 123 },
      { path: "ok.jpg", caption: "ok" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ path: "valid.jpg", caption: "" });
    expect(out[1]).toEqual({ path: "ok.jpg", caption: "ok" });
  });

  it("returns [] for non-array input", () => {
    expect(normalizeLogPhotos(null)).toEqual([]);
    expect(normalizeLogPhotos(undefined)).toEqual([]);
    expect(normalizeLogPhotos("not array")).toEqual([]);
  });

  it("preserves original_path (annotated photos keep pointer to raw file)", () => {
    const out = normalizeLogPhotos([
      { path: "a/annotated.jpg", caption: "標了紅圈", original_path: "a/raw.jpg" },
      { path: "b/plain.jpg", caption: "" },
      { path: "c/bad.jpg", caption: "", original_path: 123 },
    ]);
    expect(out[0]).toEqual({
      path: "a/annotated.jpg",
      caption: "標了紅圈",
      original_path: "a/raw.jpg",
    });
    expect(out[1]).toEqual({ path: "b/plain.jpg", caption: "" });
    // 非字串的 original_path 直接丟棄,不讓垃圾值進 DB
    expect(out[2]).toEqual({ path: "c/bad.jpg", caption: "" });
  });
});

describe("sameLocalDate", () => {
  it("matches same Taiwan-local day even when UTC differs", () => {
    // 2026-05-11 14:00 UTC = 2026-05-11 22:00 台灣 → log_date 2026-05-11 matches
    expect(sameLocalDate("2026-05-11T14:00:00Z", "2026-05-11")).toBe(true);
  });

  it("crosses midnight correctly", () => {
    // 2026-05-11 17:00 UTC = 2026-05-12 01:00 台灣 → log_date 2026-05-12 matches
    expect(sameLocalDate("2026-05-11T17:00:00Z", "2026-05-12")).toBe(true);
    expect(sameLocalDate("2026-05-11T17:00:00Z", "2026-05-11")).toBe(false);
  });

  it("returns false for null / invalid input", () => {
    expect(sameLocalDate(null, "2026-05-11")).toBe(false);
    expect(sameLocalDate("not-a-date", "2026-05-11")).toBe(false);
    expect(sameLocalDate("2026-05-11T14:00:00Z", "")).toBe(false);
  });
});

describe("todayLocalDate", () => {
  it("returns YYYY-MM-DD in Asia/Taipei regardless of runner timezone", () => {
    expect(todayLocalDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 與 sameLocalDate 用同一套時區轉換 — 「現在」一定屬於「今天」
    expect(sameLocalDate(new Date().toISOString(), todayLocalDate())).toBe(true);
  });
});

describe("parseWeather / serializeWeather / formatWeatherSummary", () => {
  it("parses JSON weather", () => {
    expect(parseWeather('{"am":"晴","pm":"小雨"}')).toEqual({ am: "晴", pm: "小雨" });
  });

  it("falls back to single string for legacy data", () => {
    expect(parseWeather("晴")).toEqual({ am: "晴" });
  });

  it("returns empty for null / empty", () => {
    expect(parseWeather(null)).toEqual({});
    expect(parseWeather("")).toEqual({});
  });

  it("serializes weather back to JSON", () => {
    expect(serializeWeather({ am: "晴", pm: "陰" })).toBe('{"am":"晴","pm":"陰"}');
  });

  it("serializes empty weather as null", () => {
    expect(serializeWeather({})).toBe(null);
  });

  it("formats weather summary", () => {
    expect(formatWeatherSummary('{"am":"晴","pm":"陰"}')).toBe("上午 晴 / 下午 陰");
    expect(formatWeatherSummary('{"am":"晴"}')).toBe("上午 晴");
    expect(formatWeatherSummary(null)).toBe("—");
  });
});

describe("buildReportNumber", () => {
  it("formats with case code", () => {
    expect(
      buildReportNumber({
        caseCode: "YM-2026-001",
        logDate: "2026-04-26",
        daySeq: 1,
      }),
    ).toBe("YM-2026-001-26042601");
  });

  it("pads daySeq to 2 digits", () => {
    expect(
      buildReportNumber({
        caseCode: "A",
        logDate: "2026-04-26",
        daySeq: 7,
      }),
    ).toBe("A-26042607");
  });

  it("uses 未編號 fallback for null case code", () => {
    expect(
      buildReportNumber({
        caseCode: null,
        logDate: "2026-04-26",
        daySeq: 1,
      }),
    ).toBe("YM-未編號-26042601");
  });

  it("floors daySeq to at least 1", () => {
    expect(
      buildReportNumber({
        caseCode: "A",
        logDate: "2026-04-26",
        daySeq: 0,
      }),
    ).toBe("A-26042601");
  });
});

describe("computeManpowerByCase", () => {
  it("sums today_total by case_id", () => {
    const out = computeManpowerByCase([
      { id: "1", case_id: "A", today_total: 5 },
      { id: "2", case_id: "A", today_total: 3 },
      { id: "3", case_id: "B", today_total: 7 },
    ]);
    expect(out).toEqual({ A: 8, B: 7 });
  });

  it("excludes given id (edit mode)", () => {
    const out = computeManpowerByCase(
      [
        { id: "1", case_id: "A", today_total: 5 },
        { id: "2", case_id: "A", today_total: 3 },
      ],
      "2",
    );
    expect(out).toEqual({ A: 5 });
  });

  it("treats null / undefined / non-number as 0", () => {
    const out = computeManpowerByCase([
      { id: "1", case_id: "A", today_total: 5 },
      { id: "2", case_id: "A", today_total: null },
      { id: "3", case_id: "A", today_total: undefined },
    ]);
    expect(out).toEqual({ A: 5 });
  });
});

describe("computeDayLaborByCase", () => {
  it("sums day_labor by case_id", () => {
    const out = computeDayLaborByCase([
      { id: "1", case_id: "A", day_labor: 2 },
      { id: "2", case_id: "A", day_labor: 3 },
      { id: "3", case_id: "B", day_labor: 1 },
    ]);
    expect(out).toEqual({ A: 5, B: 1 });
  });

  it("excludes given id (edit mode)", () => {
    const out = computeDayLaborByCase(
      [
        { id: "1", case_id: "A", day_labor: 2 },
        { id: "2", case_id: "A", day_labor: 3 },
      ],
      "2",
    );
    expect(out).toEqual({ A: 2 });
  });

  it("treats null / undefined as 0（沒填點工的日誌不影響累計）", () => {
    const out = computeDayLaborByCase([
      { id: "1", case_id: "A", day_labor: 2 },
      { id: "2", case_id: "A", day_labor: null },
      { id: "3", case_id: "A", day_labor: undefined },
    ]);
    expect(out).toEqual({ A: 2 });
  });
});

describe("computeSubcontractorTotalsByCase", () => {
  it("normalizes trade name (trim + lowercase)", () => {
    const out = computeSubcontractorTotalsByCase([
      {
        id: "1",
        case_id: "A",
        subcontractors: [
          { trade: "  水電 ", today: 2 },
          { trade: "水電", today: 3 },
          { trade: "土水", today: 1 },
        ],
      },
    ]);
    expect(out.A).toEqual({ 水電: 5, 土水: 1 });
  });

  it("handles empty trade gracefully", () => {
    const out = computeSubcontractorTotalsByCase([
      {
        id: "1",
        case_id: "A",
        subcontractors: [
          { trade: null, today: 5 },
          { trade: "", today: 5 },
          { trade: "水電", today: 2 },
        ],
      },
    ]);
    expect(out.A).toEqual({ 水電: 2 });
  });
});

describe("isBackfilledLog", () => {
  it("returns false when log_date matches created date in TW timezone", () => {
    // 2026-05-11 03:00 UTC = 2026-05-11 11:00 台灣
    expect(
      isBackfilledLog({
        log_date: "2026-05-11",
        created_at: "2026-05-11T03:00:00Z",
      }),
    ).toBe(false);
  });

  it("returns true when log_date is earlier than created date (補填)", () => {
    // created 2026-05-12 但補填 2026-05-10 的日誌
    expect(
      isBackfilledLog({
        log_date: "2026-05-10",
        created_at: "2026-05-12T03:00:00Z",
      }),
    ).toBe(true);
  });
});
