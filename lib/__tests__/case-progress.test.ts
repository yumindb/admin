import { describe, it, expect } from "vitest";
import { isCaseBehind, type CaseStats } from "../case-progress";

function makeStats(over: Partial<CaseStats> = {}): CaseStats {
  return {
    itemCount: 0,
    logCount: 0,
    progressPct: null,
    extraCount: 0,
    unsignedCount: 0,
    photos: [],
    photoTotal: 0,
    startedDaysAgo: null,
    ...over,
  };
}

describe("isCaseBehind", () => {
  it("flags as behind when < 30% and > 60 days started", () => {
    expect(
      isCaseBehind(makeStats({ progressPct: 20, startedDaysAgo: 90 })),
    ).toBe(true);
  });

  it("not behind when progress >= 30%", () => {
    expect(
      isCaseBehind(makeStats({ progressPct: 30, startedDaysAgo: 90 })),
    ).toBe(false);
    expect(
      isCaseBehind(makeStats({ progressPct: 50, startedDaysAgo: 90 })),
    ).toBe(false);
  });

  it("not behind when started <= 60 days ago (still grace period)", () => {
    expect(
      isCaseBehind(makeStats({ progressPct: 10, startedDaysAgo: 60 })),
    ).toBe(false);
    expect(
      isCaseBehind(makeStats({ progressPct: 5, startedDaysAgo: 30 })),
    ).toBe(false);
  });

  it("not behind when progress is null (no data)", () => {
    expect(
      isCaseBehind(makeStats({ progressPct: null, startedDaysAgo: 90 })),
    ).toBe(false);
  });

  it("not behind when startedDaysAgo is null (no start date)", () => {
    expect(
      isCaseBehind(makeStats({ progressPct: 10, startedDaysAgo: null })),
    ).toBe(false);
  });

  it("boundary: exactly 60 days at 29% → not behind", () => {
    expect(
      isCaseBehind(makeStats({ progressPct: 29, startedDaysAgo: 60 })),
    ).toBe(false);
  });

  it("boundary: 61 days at 29.9% → behind", () => {
    expect(
      isCaseBehind(makeStats({ progressPct: 29.9, startedDaysAgo: 61 })),
    ).toBe(true);
  });
});
