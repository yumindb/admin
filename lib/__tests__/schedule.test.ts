import { describe, expect, it } from "vitest";
import {
  addDays,
  crossesMidnight,
  describeEntry,
  entryChipLabel,
  groupEntries,
  indexTemplates,
  isValidTime,
  normalizeTime,
  resolveEntryTimes,
  shiftDurationMinutes,
  weekDates,
  weekStartOf,
  type ScheduleEntry,
  type ShiftTemplate,
} from "../payroll/schedule";

const day: ShiftTemplate = {
  id: "t-day",
  name: "日班",
  short_name: "日",
  start_time: "08:00",
  end_time: "17:00",
  break_minutes: 60,
  company: null,
  sort_order: 0,
  is_active: true,
};
const night: ShiftTemplate = { ...day, id: "t-night", name: "晚班", short_name: "晚", start_time: "18:00", end_time: "02:00", break_minutes: 30 };
const templates = indexTemplates([day, night]);

function entry(p: Partial<ScheduleEntry>): ScheduleEntry {
  return {
    id: p.id ?? "e",
    user_id: p.user_id ?? "u1",
    work_date: p.work_date ?? "2026-09-28",
    shift_template_id: p.shift_template_id ?? null,
    start_time: p.start_time ?? null,
    end_time: p.end_time ?? null,
    case_id: null,
    note: null,
  };
}

describe("班別時間", () => {
  it("time 欄位正規化與檢查", () => {
    expect(normalizeTime("08:00:00")).toBe("08:00");
    expect(normalizeTime("8:00")).toBe("8:00");
    expect(isValidTime("08:00:00")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("8:00")).toBe(false);
  });

  it("日班 08–17 扣 60 分 = 8 小時;晚班 18–02 跨日扣 30 分 = 7.5 小時", () => {
    expect(shiftDurationMinutes("08:00", "17:00", 60)).toBe(480);
    expect(shiftDurationMinutes("18:00", "02:00", 30)).toBe(450);
    expect(crossesMidnight("18:00", "02:00")).toBe(true);
    expect(crossesMidnight("08:00", "17:00")).toBe(false);
  });

  it("休息扣到負的回 0", () => {
    expect(shiftDurationMinutes("09:00", "09:30", 60)).toBe(0);
  });

  it("範本優先、自訂時間覆寫、範本被移除回 null", () => {
    expect(resolveEntryTimes(entry({ shift_template_id: "t-day" }), templates)).toMatchObject({
      start: "08:00",
      end: "17:00",
      breakMinutes: 60,
    });
    expect(
      resolveEntryTimes(entry({ shift_template_id: "t-day", start_time: "09:00:00", end_time: "15:00:00" }), templates),
    ).toMatchObject({ start: "09:00", end: "15:00", breakMinutes: 60 });
    expect(resolveEntryTimes(entry({ start_time: "10:00", end_time: "14:00" }), templates)).toMatchObject({
      start: "10:00",
      end: "14:00",
      breakMinutes: 0,
      template: null,
    });
    expect(resolveEntryTimes(entry({ shift_template_id: "gone" }), templates)).toBeNull();
  });

  it("格子短標籤與說明", () => {
    expect(entryChipLabel(entry({ shift_template_id: "t-night" }), templates)).toBe("晚");
    expect(entryChipLabel(entry({ start_time: "10:00", end_time: "14:00" }), templates)).toBe("10–14");
    expect(describeEntry(entry({ shift_template_id: "t-night" }), templates)).toBe("晚班 18:00–02:00（跨日）");
    expect(describeEntry(entry({ start_time: "10:00", end_time: "14:00" }), templates)).toBe("自訂 10:00–14:00");
    expect(describeEntry(entry({ shift_template_id: "gone" }), templates)).toBe("（班別已移除）");
  });
});

describe("週與日期", () => {
  it("週一起算;跨月、跨年都對", () => {
    expect(weekStartOf("2026-09-26")).toBe("2026-09-21"); // 週六
    expect(weekStartOf("2026-09-28")).toBe("2026-09-28"); // 週一
    expect(weekStartOf("2026-09-27")).toBe("2026-09-21"); // 週日
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(weekDates("2026-09-28")[6]).toBe("2026-10-04");
  });

  it("分組", () => {
    const g = groupEntries([
      entry({ id: "a", user_id: "u1", work_date: "2026-09-28" }),
      entry({ id: "b", user_id: "u1", work_date: "2026-09-28" }),
      entry({ id: "c", user_id: "u2", work_date: "2026-09-29" }),
    ]);
    expect(g.get("u1")?.get("2026-09-28")?.map((e) => e.id)).toEqual(["a", "b"]);
    expect(g.get("u2")?.get("2026-09-29")?.length).toBe(1);
    expect(g.get("u2")?.get("2026-09-28")).toBeUndefined();
  });
});
