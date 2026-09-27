import { describe, expect, it } from "vitest";
import { defaultPayrollSettings, type PayrollSettings } from "../payroll/settings";
import { indexHolidays } from "../payroll/holidays";
import { indexTemplates, type ScheduleEntry, type ShiftTemplate } from "../payroll/schedule";
import {
  computeWorkHours,
  leaveHoursOn,
  pairEvents,
  roundDownToUnit,
  taipeiDate,
  type LeaveSpan,
  type WorkEvent,
} from "../payroll/work-hours";

/** 台灣時間的事件("2026-09-28 08:00" → ISO +08:00) */
function ev(id: string, type: "clock_in" | "clock_out", tpe: string, caseId: string | null = null): WorkEvent {
  return { id, event_type: type, created_at: new Date(`${tpe.replace(" ", "T")}:00+08:00`).toISOString(), case_id: caseId, source: "web" };
}

const day: ShiftTemplate = { id: "t-day", name: "日班", short_name: "日", start_time: "08:00", end_time: "17:00", break_minutes: 60, company: null, sort_order: 0, is_active: true };
const night: ShiftTemplate = { ...day, id: "t-night", name: "晚班", short_name: "晚", start_time: "18:00", end_time: "02:00", break_minutes: 30 };
const templatesById = indexTemplates([day, night]);
const holidaysByDate = indexHolidays([{ holiday_date: "2026-10-09", name: "國慶日補假", is_workday: false }]);

function sched(date: string, templateId = "t-day"): ScheduleEntry {
  return { id: `s-${date}`, user_id: "u1", work_date: date, shift_template_id: templateId, start_time: null, end_time: null, case_id: null, note: null };
}

function run(opts: {
  from: string;
  to: string;
  events?: WorkEvent[];
  schedule?: ScheduleEntry[];
  leaves?: LeaveSpan[];
  settings?: PayrollSettings;
}) {
  return computeWorkHours({
    from: opts.from,
    to: opts.to,
    events: opts.events ?? [],
    schedule: opts.schedule ?? [],
    templatesById,
    holidaysByDate,
    leaves: opts.leaves ?? [],
    settings: opts.settings ?? defaultPayrollSettings(),
  });
}

describe("打卡配對", () => {
  it("正常一進一出;歸屬台灣日期", () => {
    const { sessions, anomalies } = pairEvents([ev("1", "clock_in", "2026-09-28 08:00"), ev("2", "clock_out", "2026-09-28 17:00")]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].minutes).toBe(540);
    expect(anomalies).toEqual([]);
    expect(taipeiDate(sessions[0].inAt)).toBe("2026-09-28");
  });

  it("跨午夜晚班歸屬上班那天", () => {
    const { sessions } = pairEvents([ev("1", "clock_in", "2026-09-28 18:00"), ev("2", "clock_out", "2026-09-29 02:00")]);
    expect(sessions[0].minutes).toBe(480);
    expect(taipeiDate(sessions[0].inAt)).toBe("2026-09-28");
  });

  it("連兩個上班卡 → 前一段沒下班卡;只有下班卡 → 沒上班卡;最後開著 → 沒下班卡", () => {
    const { sessions, anomalies } = pairEvents([
      ev("1", "clock_in", "2026-09-28 08:00"),
      ev("2", "clock_in", "2026-09-28 13:00"),
      ev("3", "clock_out", "2026-09-28 17:00"),
      ev("4", "clock_out", "2026-09-29 17:00"),
      ev("5", "clock_in", "2026-09-30 08:00"),
    ]);
    expect(sessions.map((s) => s.minutes)).toEqual([0, 240, 0]);
    expect(anomalies.map((a) => a.kind)).toEqual(["missing_out", "missing_in", "missing_out"]);
    expect(anomalies[1].date).toBe("2026-09-29");
  });

  it("相隔超過 18 小時當成漏卡,不算工時", () => {
    const { sessions, anomalies } = pairEvents([ev("1", "clock_in", "2026-09-28 08:00"), ev("2", "clock_out", "2026-09-29 08:00")]);
    expect(sessions[0].minutes).toBe(0);
    expect(anomalies[0].kind).toBe("too_long");
  });

  it("一天跑兩個工地 = 兩段", () => {
    const { sessions } = pairEvents([
      ev("1", "clock_in", "2026-09-28 08:00", "A"),
      ev("2", "clock_out", "2026-09-28 12:00", "A"),
      ev("3", "clock_in", "2026-09-28 13:00", "B"),
      ev("4", "clock_out", "2026-09-28 18:00", "B"),
    ]);
    expect(sessions.map((s) => [s.caseId, s.minutes])).toEqual([["A", 240], ["B", 300]]);
  });
});

describe("每日工時拆解", () => {
  it("排日班 08–17 打滿:扣 60 分休息 = 8 小時正常,0 加班", () => {
    const { days, summary } = run({
      from: "2026-09-28",
      to: "2026-09-28",
      events: [ev("1", "clock_in", "2026-09-28 08:00"), ev("2", "clock_out", "2026-09-28 17:00")],
      schedule: [sched("2026-09-28")],
    });
    const d = days[0];
    expect(d.dayType).toBe("workday");
    expect(d.breakMinutes).toBe(60);
    expect(d.workedMinutes).toBe(480);
    expect(d.regularMinutes).toBe(480);
    expect(d.otSegments).toEqual([]);
    expect(d.lateMinutes).toBe(0);
    expect(summary.workedDays).toBe(1);
    expect(summary.scheduledDays).toBe(1);
  });

  it("平日做到 20:00:2 小時 ×1.34;做到 22:00:再 2 小時 ×1.67;做到 23:00 超出分段沿用最後倍率", () => {
    const at = (out: string) =>
      run({ from: "2026-09-28", to: "2026-09-28", events: [ev("1", "clock_in", "2026-09-28 08:00"), ev("2", "clock_out", `2026-09-28 ${out}`)], schedule: [sched("2026-09-28")] }).days[0].otSegments;
    expect(at("19:00")).toEqual([{ tier: 1, minutes: 120, multiplier: 1.34 }]);
    expect(at("21:00")).toEqual([
      { tier: 1, minutes: 120, multiplier: 1.34 },
      { tier: 2, minutes: 120, multiplier: 1.67 },
    ]);
    expect(at("22:00")).toEqual([
      { tier: 1, minutes: 120, multiplier: 1.34 },
      { tier: 2, minutes: 120, multiplier: 1.67 },
      { tier: 0, minutes: 60, multiplier: 1.67 },
    ]);
  });

  it("沒排班的週六 = 休息日:從第 1 小時起分段(10 小時 → 2 / 6 / 2)", () => {
    const { days } = run({
      from: "2026-09-26",
      to: "2026-09-26",
      events: [ev("1", "clock_in", "2026-09-26 08:00"), ev("2", "clock_out", "2026-09-26 19:00")],
    });
    const d = days[0];
    expect(d.dayType).toBe("rest_day");
    expect(d.breakMinutes).toBe(60); // 沒排班:單段超過 6 小時自動扣 60
    expect(d.regularMinutes).toBe(0);
    expect(d.otSegments).toEqual([
      { tier: 1, minutes: 120, multiplier: 1.34 },
      { tier: 2, minutes: 360, multiplier: 1.67 },
      { tier: 3, minutes: 120, multiplier: 2.67 },
    ]);
  });

  it("排了班的週六一律算平日", () => {
    const { days } = run({
      from: "2026-09-26",
      to: "2026-09-26",
      events: [ev("1", "clock_in", "2026-09-26 08:00"), ev("2", "clock_out", "2026-09-26 17:00")],
      schedule: [sched("2026-09-26")],
    });
    expect(days[0].dayType).toBe("workday");
    expect(days[0].regularMinutes).toBe(480);
  });

  it("週日 = 例假日、國定假日:整天 ×2", () => {
    const sun = run({ from: "2026-09-27", to: "2026-09-27", events: [ev("1", "clock_in", "2026-09-27 09:00"), ev("2", "clock_out", "2026-09-27 13:00")] }).days[0];
    expect(sun.dayType).toBe("regular_off");
    expect(sun.holidayMinutes).toBe(240);
    expect(sun.holidayMultiplier).toBe(2);
    const hol = run({ from: "2026-10-09", to: "2026-10-09", events: [ev("1", "clock_in", "2026-10-09 09:00"), ev("2", "clock_out", "2026-10-09 13:00")] }).days[0];
    expect(hol.dayType).toBe("holiday");
    expect(hol.holidayMinutes).toBe(240);
  });

  it("加班計算單位 30 分:加班 50 分只算 30", () => {
    const settings = defaultPayrollSettings();
    settings.work_rules.ot_unit_minutes = 30;
    const { days } = run({
      from: "2026-09-28",
      to: "2026-09-28",
      events: [ev("1", "clock_in", "2026-09-28 08:00"), ev("2", "clock_out", "2026-09-28 17:50")],
      schedule: [sched("2026-09-28")],
      settings,
    });
    expect(days[0].otSegments).toEqual([{ tier: 1, minutes: 30, multiplier: 1.34 }]);
    expect(roundDownToUnit(59, 30)).toBe(30);
    expect(roundDownToUnit(59, 1)).toBe(59);
  });

  it("跨日晚班:排 18–02 休 30,打 18:00–02:10 → 7.5 小時正常 + 10 分加班;早退以隔天下班算", () => {
    const { days } = run({
      from: "2026-09-28",
      to: "2026-09-28",
      events: [ev("1", "clock_in", "2026-09-28 18:00"), ev("2", "clock_out", "2026-09-29 02:10")],
      schedule: [sched("2026-09-28", "t-night")],
    });
    const d = days[0];
    expect(d.workedMinutes).toBe(460);
    expect(d.regularMinutes).toBe(460);
    expect(d.otSegments).toEqual([]);
    expect(d.earlyMinutes).toBe(0);
  });
});

describe("遲到 / 早退 / 缺勤 / 請假", () => {
  it("寬限 10 分內不算遲到;超過就從排定時間起算全部分鐘", () => {
    const late = (inT: string) =>
      run({ from: "2026-09-28", to: "2026-09-28", events: [ev("1", "clock_in", `2026-09-28 ${inT}`), ev("2", "clock_out", "2026-09-28 17:00")], schedule: [sched("2026-09-28")] }).days[0].lateMinutes;
    expect(late("08:09")).toBe(0);
    expect(late("08:10")).toBe(0);
    expect(late("08:11")).toBe(11);
    expect(late("09:00")).toBe(60);
  });

  it("早退:17:00 的班 16:30 下班 = 30 分", () => {
    const { days } = run({ from: "2026-09-28", to: "2026-09-28", events: [ev("1", "clock_in", "2026-09-28 08:00"), ev("2", "clock_out", "2026-09-28 16:30")], schedule: [sched("2026-09-28")] });
    expect(days[0].earlyMinutes).toBe(30);
  });

  it("排了班沒打卡也沒請假 = 缺勤;有請假就不是", () => {
    const absent = run({ from: "2026-09-28", to: "2026-09-28", schedule: [sched("2026-09-28")] });
    expect(absent.days[0].absent).toBe(true);
    expect(absent.summary.absentDays).toBe(1);
    expect(absent.summary.anomalies[0].kind).toBe("absent");

    const onLeave = run({
      from: "2026-09-28",
      to: "2026-09-28",
      schedule: [sched("2026-09-28")],
      leaves: [{ leave_type: "sick", start_at: "2026-09-28T00:00:00+08:00", end_at: "2026-09-29T00:00:00+08:00", total_hours: 8 }],
    });
    expect(onLeave.days[0].absent).toBe(false);
    expect(onLeave.days[0].leave).toEqual({ type: "sick", hours: 8 });
    expect(onLeave.summary.leaveHours).toEqual({ sick: 8 });
  });

  it("請假時數:半天假 4 小時;三天假每天 8;跨到範圍外只算範圍內", () => {
    const half: LeaveSpan = { leave_type: "personal", start_at: "2026-09-28T13:00:00+08:00", end_at: "2026-09-28T17:00:00+08:00", total_hours: 4 };
    expect(leaveHoursOn("2026-09-28", [half], 8)).toEqual({ type: "personal", hours: 4 });
    const three: LeaveSpan = { leave_type: "annual", start_at: "2026-09-28T00:00:00+08:00", end_at: "2026-10-01T00:00:00+08:00", total_hours: 24 };
    expect(leaveHoursOn("2026-09-29", [three], 8)).toEqual({ type: "annual", hours: 8 });
    expect(leaveHoursOn("2026-10-01", [three], 8)).toBeNull();
  });
});

describe("月彙總", () => {
  it("加班超過每月上限只標記,不擋;各倍率分開加總", () => {
    const events: WorkEvent[] = [];
    const schedule: ScheduleEntry[] = [];
    // 週一到週五各做到 21:00(每天 4 小時加班),兩週 = 40 小時;再一個週六 8 小時 → 48 > 46
    const dates = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
    dates.forEach((d, i) => {
      events.push(ev(`i${i}`, "clock_in", `${d} 08:00`), ev(`o${i}`, "clock_out", `${d} 21:00`));
      schedule.push(sched(d));
    });
    events.push(ev("si", "clock_in", "2026-10-03 08:00"), ev("so", "clock_out", "2026-10-03 17:00"));
    const { summary } = run({ from: "2026-09-28", to: "2026-10-10", events, schedule });
    expect(summary.weekdayOt).toEqual([
      { multiplier: 1.34, minutes: 1200 },
      { multiplier: 1.67, minutes: 1200 },
    ]);
    expect(summary.restDayOt).toEqual([
      { multiplier: 1.34, minutes: 120 },
      { multiplier: 1.67, minutes: 360 },
    ]);
    expect(summary.totalOtMinutes).toBe(2880);
    expect(summary.otCapExceeded).toBe(true);
    expect(summary.workedDays).toBe(11);
    expect(summary.scheduledDays).toBe(10);
  });
});
