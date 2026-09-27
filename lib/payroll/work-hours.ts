import type { LeaveType } from "@/lib/types";
import { dayTypeFor, type DayType, type Holiday } from "./holidays";
import {
  addDays,
  resolveEntryTimes,
  timeToMinutes,
  type ScheduleEntry,
  type ShiftTemplate,
} from "./schedule";
import type { PayrollSettings } from "./settings";

/**
 * 工時對帳引擎(Phase C)。純函式、不碰 DB;資料由 work-hours-data.ts 撈好餵進來。
 *
 * 做的事:
 *   1. 把 attendance_events 依時間序配對成工作段(clock_in → clock_out)。
 *      配不起來的**不猜**,標成異常讓辦公室用既有的補登功能補。
 *      工作段歸屬到「上班打卡那天」(台灣日界),所以餐飲跨午夜的晚班不會被切成兩天。
 *   2. 每天:扣休息(有排班照班別的休息分鐘;沒排班用「單段超過 N 小時扣 M 分」)、
 *      判日型別(有排班一律平日;沒排班看假日表與週幾)、拆正常工時 / 分段加班 / 假日出勤。
 *   3. 遲到 / 早退(對排班)、缺勤(排了班沒來也沒請假)、請假時數(對核准的假單)。
 *   4. 月彙總:天數、各倍率時數、加班上限警告、異常清單。
 *
 * 這裡只算「時數 × 倍率」,不算錢 — 金額在 Phase D 乘上時薪。
 */

export type WorkEvent = {
  id: string;
  event_type: "clock_in" | "clock_out";
  /** ISO timestamptz */
  created_at: string;
  case_id: string | null;
  source: string | null;
};

export type LeaveSpan = {
  leave_type: LeaveType;
  start_at: string;
  end_at: string;
  total_hours: number;
};

export type WorkSession = {
  inAt: string;
  /** null = 沒有下班卡 */
  outAt: string | null;
  /** 已配對的分鐘數(未扣休息);沒配對成功 = 0 */
  minutes: number;
  caseId: string | null;
  inSource: string | null;
  outSource: string | null;
};

export type AnomalyKind = "missing_out" | "missing_in" | "too_long" | "absent";

export type Anomaly = {
  date: string;
  kind: AnomalyKind;
  /** 給人看的一句話 */
  detail: string;
};

export const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  missing_out: "只有上班卡,沒有下班卡",
  missing_in: "只有下班卡,沒有上班卡",
  too_long: "上下班相隔超過 18 小時,當成漏卡",
  absent: "有排班,沒打卡也沒請假",
};

export type OtSegment = {
  /** 第幾段(從 1 起);0 = 超過設定的分段,沿用最後一段倍率 */
  tier: number;
  minutes: number;
  multiplier: number;
};

export type DayResult = {
  date: string;
  dayType: DayType;
  /** 有排班的話:最早上班 / 最晚下班(HH:MM)與休息總分鐘 */
  scheduled: { start: string; end: string; breakMinutes: number; entries: number } | null;
  sessions: WorkSession[];
  /** 打卡加總(未扣休息) */
  rawMinutes: number;
  breakMinutes: number;
  /** 扣休息後 */
  workedMinutes: number;
  regularMinutes: number;
  /** 平日延長 / 休息日的分段 */
  otSegments: OtSegment[];
  /** 例假日 / 國定假日出勤(整天同一倍率) */
  holidayMinutes: number;
  holidayMultiplier: number;
  lateMinutes: number;
  earlyMinutes: number;
  absent: boolean;
  leave: { type: LeaveType; hours: number } | null;
  anomalies: Anomaly[];
};

export type WorkHoursSummary = {
  scheduledDays: number;
  /** 有實際工時的天數(日薪人員的出勤天數) */
  workedDays: number;
  rawMinutes: number;
  workedMinutes: number;
  regularMinutes: number;
  /** 平日延長,依倍率彙總 */
  weekdayOt: { multiplier: number; minutes: number }[];
  /** 休息日出勤,依倍率彙總 */
  restDayOt: { multiplier: number; minutes: number }[];
  holidayMinutes: number;
  holidayMultiplier: number;
  /** 全部加班(平日延長 + 休息日 + 假日)分鐘,對照每月上限 */
  totalOtMinutes: number;
  otCapMinutes: number;
  otCapExceeded: boolean;
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  absentDays: number;
  leaveHours: Partial<Record<LeaveType, number>>;
  anomalies: Anomaly[];
};

export type WorkHoursInput = {
  /** YYYY-MM-DD,含 */
  from: string;
  to: string;
  /** 可含範圍外(前後一天)的事件;時間順序不拘 */
  events: WorkEvent[];
  schedule: ScheduleEntry[];
  templatesById: ReadonlyMap<string, ShiftTemplate>;
  holidaysByDate: ReadonlyMap<string, Holiday>;
  /** 已核准的假 */
  leaves: LeaveSpan[];
  settings: PayrollSettings;
};

const TZ = "Asia/Taipei";
const MAX_SESSION_MINUTES = 18 * 60;

/** ISO → 台灣日期 YYYY-MM-DD */
export function taipeiDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

/** ISO → 台灣 HH:MM */
export function taipeiTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 加班分鐘依計算單位無條件捨去(unit = 1 就是不捨去) */
export function roundDownToUnit(minutes: number, unit: number): number {
  if (unit <= 1) return Math.max(0, Math.round(minutes));
  return Math.max(0, Math.floor(minutes / unit) * unit);
}

/**
 * 依時間序配對:clock_in 開一段,下一個 clock_out 關掉。
 * 連兩個 clock_in → 前一段標「沒下班卡」;clock_out 沒有開著的段 → 「沒上班卡」;
 * 相隔超過 18 小時 → 當成兩邊都漏卡(不猜是誰忘了)。
 */
export function pairEvents(events: readonly WorkEvent[]): {
  sessions: WorkSession[];
  anomalies: Anomaly[];
} {
  const sorted = [...events].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const sessions: WorkSession[] = [];
  const anomalies: Anomaly[] = [];
  let open: WorkSession | null = null;

  const closeAsMissingOut = (s: WorkSession) => {
    sessions.push(s);
    anomalies.push({
      date: taipeiDate(s.inAt),
      kind: "missing_out",
      detail: `${taipeiTime(s.inAt)} 上班,沒有下班卡`,
    });
  };

  for (const e of sorted) {
    if (e.event_type === "clock_in") {
      if (open) closeAsMissingOut(open);
      open = { inAt: e.created_at, outAt: null, minutes: 0, caseId: e.case_id, inSource: e.source, outSource: null };
      continue;
    }
    // clock_out
    if (!open) {
      anomalies.push({
        date: taipeiDate(e.created_at),
        kind: "missing_in",
        detail: `${taipeiTime(e.created_at)} 下班,沒有上班卡`,
      });
      continue;
    }
    const minutes = (new Date(e.created_at).getTime() - new Date(open.inAt).getTime()) / 60_000;
    if (minutes > MAX_SESSION_MINUTES) {
      // 兩邊都當漏卡
      sessions.push(open);
      anomalies.push({
        date: taipeiDate(open.inAt),
        kind: "too_long",
        detail: `${taipeiDate(open.inAt)} ${taipeiTime(open.inAt)} 上班到 ${taipeiDate(e.created_at)} ${taipeiTime(e.created_at)} 下班,相隔超過 18 小時`,
      });
      open = null;
      continue;
    }
    open.outAt = e.created_at;
    open.minutes = Math.round(minutes);
    open.outSource = e.source;
    open.caseId = open.caseId ?? e.case_id;
    sessions.push(open);
    open = null;
  }
  if (open) closeAsMissingOut(open);
  return { sessions, anomalies };
}

/** 某天的請假時數:假單區間與該台灣日的重疊小時數,上限每日正常工時 */
export function leaveHoursOn(
  dateIso: string,
  leaves: readonly LeaveSpan[],
  dailyHours: number,
): { type: LeaveType; hours: number } | null {
  const dayStart = new Date(`${dateIso}T00:00:00+08:00`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  let best: { type: LeaveType; hours: number } | null = null;
  for (const l of leaves) {
    const s = Math.max(new Date(l.start_at).getTime(), dayStart);
    const e = Math.min(new Date(l.end_at).getTime(), dayEnd);
    if (e <= s) continue;
    // 多日假:每天算滿一天;單日時段假:算重疊時數(上限一天)
    const overlap = Math.min((e - s) / 3_600_000, dailyHours);
    const hours = Math.round(overlap * 2) / 2;
    if (hours <= 0) continue;
    if (!best) best = { type: l.leave_type, hours };
    else best = { type: best.type, hours: Math.min(dailyHours, best.hours + hours) };
  }
  return best;
}

function splitIntoTiers(
  minutes: number,
  tiers: readonly { hours: number; multiplier: number }[],
): OtSegment[] {
  const out: OtSegment[] = [];
  let left = minutes;
  tiers.forEach((t, i) => {
    if (left <= 0) return;
    const take = Math.min(left, Math.round(t.hours * 60));
    if (take > 0) out.push({ tier: i + 1, minutes: take, multiplier: t.multiplier });
    left -= take;
  });
  if (left > 0 && tiers.length > 0) {
    out.push({ tier: 0, minutes: left, multiplier: tiers[tiers.length - 1].multiplier });
  }
  return out;
}

export function computeWorkHours(input: WorkHoursInput): { days: DayResult[]; summary: WorkHoursSummary } {
  const { settings } = input;
  const wr = settings.work_rules;
  const ot = settings.overtime;
  const dailyMinutes = Math.round(wr.daily_hours * 60);

  const { sessions, anomalies: pairingAnomalies } = pairEvents(input.events);
  const sessionsByDate = new Map<string, WorkSession[]>();
  for (const s of sessions) {
    const d = taipeiDate(s.inAt);
    const list = sessionsByDate.get(d);
    if (list) list.push(s);
    else sessionsByDate.set(d, [s]);
  }
  const anomaliesByDate = new Map<string, Anomaly[]>();
  for (const a of pairingAnomalies) {
    const list = anomaliesByDate.get(a.date);
    if (list) list.push(a);
    else anomaliesByDate.set(a.date, [a]);
  }
  const scheduleByDate = new Map<string, ScheduleEntry[]>();
  for (const e of input.schedule) {
    const list = scheduleByDate.get(e.work_date);
    if (list) list.push(e);
    else scheduleByDate.set(e.work_date, [e]);
  }

  const days: DayResult[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    const daySessions = sessionsByDate.get(d) ?? [];
    const dayAnomalies = [...(anomaliesByDate.get(d) ?? [])];
    const entries = scheduleByDate.get(d) ?? [];

    // 排班:最早上班、最晚下班、休息總和
    let scheduled: DayResult["scheduled"] = null;
    for (const e of entries) {
      const t = resolveEntryTimes(e, input.templatesById);
      if (!t) continue;
      if (!scheduled) {
        scheduled = { start: t.start, end: t.end, breakMinutes: t.breakMinutes, entries: 1 };
      } else {
        scheduled.start = t.start < scheduled.start ? t.start : scheduled.start;
        scheduled.end = t.end > scheduled.end ? t.end : scheduled.end;
        scheduled.breakMinutes += t.breakMinutes;
        scheduled.entries += 1;
      }
    }

    const rawMinutes = daySessions.reduce((s, x) => s + x.minutes, 0);
    let breakMinutes = 0;
    if (scheduled) {
      breakMinutes = scheduled.breakMinutes;
    } else if (wr.auto_break_after_hours > 0) {
      breakMinutes = daySessions.filter((s) => s.minutes > wr.auto_break_after_hours * 60).length * wr.auto_break_minutes;
    }
    breakMinutes = Math.min(breakMinutes, rawMinutes);
    const workedMinutes = rawMinutes - breakMinutes;

    const dayType: DayType = scheduled ? "workday" : dayTypeFor(d, input.holidaysByDate, ot);

    let regularMinutes = 0;
    let otSegments: OtSegment[] = [];
    let holidayMinutes = 0;
    if (dayType === "workday") {
      regularMinutes = Math.min(workedMinutes, dailyMinutes);
      otSegments = splitIntoTiers(roundDownToUnit(workedMinutes - regularMinutes, wr.ot_unit_minutes), ot.weekday_tiers);
    } else if (dayType === "rest_day") {
      otSegments = splitIntoTiers(roundDownToUnit(workedMinutes, wr.ot_unit_minutes), ot.rest_day_tiers);
    } else {
      holidayMinutes = roundDownToUnit(workedMinutes, wr.ot_unit_minutes);
    }

    // 遲到 / 早退(只有排班才有基準)
    let lateMinutes = 0;
    let earlyMinutes = 0;
    if (scheduled && daySessions.length > 0) {
      const first = daySessions.reduce((a, b) => (a.inAt < b.inAt ? a : b));
      const inMin = timeToMinutes(taipeiTime(first.inAt));
      const startMin = timeToMinutes(scheduled.start);
      if (inMin > startMin + settings.late.grace_minutes) lateMinutes = inMin - startMin;

      const withOut = daySessions.filter((s) => s.outAt);
      if (withOut.length > 0) {
        const last = withOut.reduce((a, b) => ((a.outAt ?? "") > (b.outAt ?? "") ? a : b));
        let outMin = timeToMinutes(taipeiTime(last.outAt as string));
        let endMin = timeToMinutes(scheduled.end);
        // 跨日班:下班在隔天
        if (endMin <= startMin) endMin += 24 * 60;
        if (taipeiDate(last.outAt as string) !== d) outMin += 24 * 60;
        if (outMin < endMin) earlyMinutes = endMin - outMin;
      }
    }

    const leave = leaveHoursOn(d, input.leaves, wr.daily_hours);
    const absent = !!scheduled && daySessions.length === 0 && !leave;
    if (absent) dayAnomalies.push({ date: d, kind: "absent", detail: `排了 ${scheduled!.start}–${scheduled!.end},沒有打卡也沒有請假` });

    days.push({
      date: d,
      dayType,
      scheduled,
      sessions: daySessions,
      rawMinutes,
      breakMinutes,
      workedMinutes,
      regularMinutes,
      otSegments,
      holidayMinutes,
      holidayMultiplier: ot.holiday_multiplier,
      lateMinutes,
      earlyMinutes,
      absent,
      leave,
      anomalies: dayAnomalies,
    });
  }

  // 彙總
  const weekdayOt = new Map<number, number>();
  const restDayOt = new Map<number, number>();
  const leaveHours: Partial<Record<LeaveType, number>> = {};
  const summary: WorkHoursSummary = {
    scheduledDays: 0,
    workedDays: 0,
    rawMinutes: 0,
    workedMinutes: 0,
    regularMinutes: 0,
    weekdayOt: [],
    restDayOt: [],
    holidayMinutes: 0,
    holidayMultiplier: ot.holiday_multiplier,
    totalOtMinutes: 0,
    otCapMinutes: Math.round(wr.monthly_ot_cap_hours * 60),
    otCapExceeded: false,
    lateCount: 0,
    lateMinutes: 0,
    earlyCount: 0,
    absentDays: 0,
    leaveHours,
    anomalies: [],
  };
  for (const day of days) {
    if (day.scheduled) summary.scheduledDays += 1;
    if (day.workedMinutes > 0) summary.workedDays += 1;
    summary.rawMinutes += day.rawMinutes;
    summary.workedMinutes += day.workedMinutes;
    summary.regularMinutes += day.regularMinutes;
    for (const seg of day.otSegments) {
      const target = day.dayType === "rest_day" ? restDayOt : weekdayOt;
      target.set(seg.multiplier, (target.get(seg.multiplier) ?? 0) + seg.minutes);
      summary.totalOtMinutes += seg.minutes;
    }
    summary.holidayMinutes += day.holidayMinutes;
    summary.totalOtMinutes += day.holidayMinutes;
    if (day.lateMinutes > 0) {
      summary.lateCount += 1;
      summary.lateMinutes += day.lateMinutes;
    }
    if (day.earlyMinutes > 0) summary.earlyCount += 1;
    if (day.absent) summary.absentDays += 1;
    if (day.leave) leaveHours[day.leave.type] = (leaveHours[day.leave.type] ?? 0) + day.leave.hours;
    summary.anomalies.push(...day.anomalies);
  }
  summary.weekdayOt = [...weekdayOt.entries()].sort((a, b) => a[0] - b[0]).map(([multiplier, minutes]) => ({ multiplier, minutes }));
  summary.restDayOt = [...restDayOt.entries()].sort((a, b) => a[0] - b[0]).map(([multiplier, minutes]) => ({ multiplier, minutes }));
  summary.otCapExceeded = summary.otCapMinutes > 0 && summary.totalOtMinutes > summary.otCapMinutes;

  return { days, summary };
}

/** 90 → "1.5",480 → "8" */
export function minutesToHoursLabel(minutes: number): string {
  const h = minutes / 60;
  return (Math.round(h * 100) / 100).toString();
}
