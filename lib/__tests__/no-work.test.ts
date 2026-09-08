import { describe, expect, it } from "vitest";
import { formatNoWorkLabel, isNoWorkLog, NO_WORK_REASONS } from "../daily-log";
import { diffSnapshot } from "../log-diff";
import type { DailyLogSnapshot } from "../types";

/**
 * 「本日無施工」(2026-09 業主要求):旗標放 manpower jsonb,沒有 migration。
 * 這裡守住三件事:判定只認 `no_work === true`、文案格式、編輯軌跡看得到旗標切換。
 */
describe("isNoWorkLog", () => {
  it("只有 no_work === true 才算", () => {
    expect(isNoWorkLog({ no_work: true })).toBe(true);
    expect(isNoWorkLog({ no_work: false })).toBe(false);
    expect(isNoWorkLog({ today_total: 0 })).toBe(false);
    expect(isNoWorkLog({})).toBe(false);
    expect(isNoWorkLog(null)).toBe(false);
    expect(isNoWorkLog(undefined)).toBe(false);
  });
});

describe("formatNoWorkLabel", () => {
  it("沒原因就只寫本日無施工", () => {
    expect(formatNoWorkLabel({ no_work: true })).toBe("本日無施工");
    expect(formatNoWorkLabel({ no_work: true, no_work_reason: "  " })).toBe("本日無施工");
  });
  it("有原因用全形括號附上", () => {
    expect(formatNoWorkLabel({ no_work: true, no_work_reason: "天候不佳" })).toBe(
      "本日無施工（天候不佳）",
    );
  });
  it("常用原因選項都不是空字串", () => {
    expect(NO_WORK_REASONS.length).toBeGreaterThan(0);
    for (const r of NO_WORK_REASONS) expect(r.trim()).not.toBe("");
  });
});

function snap(partial: Partial<DailyLogSnapshot>): DailyLogSnapshot {
  return {
    log_date: "2026-09-08",
    weather: null,
    manpower: {},
    work_items: [],
    extra_items: [],
    unsigned_items: [],
    photos: [],
    vendor_notices: null,
    notes: null,
    ...partial,
  };
}

describe("diffSnapshot — 無施工旗標", () => {
  it("助理把無施工改成有施工,軌跡列出旗標與原因", () => {
    const before = snap({ manpower: { no_work: true, no_work_reason: "等材料", today_total: 0 } });
    const after = snap({ manpower: { today_total: 3 } });
    const changes = diffSnapshot(before, after, ["manpower"], () => null);
    expect(changes).toHaveLength(1);
    const rows = changes[0].rows;
    expect(rows).toContainEqual({ label: "本日無施工", before: "是", after: "否" });
    expect(rows).toContainEqual({
      label: "無施工原因",
      before: "等材料",
      after: "（空白）",
    });
    expect(rows).toContainEqual({ label: "本日出工人數", before: "0", after: "3" });
  });

  it("旗標沒動就不列", () => {
    const before = snap({ manpower: { no_work: true, today_total: 0 } });
    const after = snap({ manpower: { today_total: 0, no_work: true } });
    expect(diffSnapshot(before, after, ["manpower"], () => null)).toHaveLength(0);
  });
});
