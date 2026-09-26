import { isoWeekday } from "./holidays";

/**
 * 排班(shift_templates + schedule_entries,migration-2.41)的型別與純函式。
 *
 * 時間欄位是 Postgres `time`,讀出來是 "HH:MM:SS";這裡一律正規化成 "HH:MM"。
 * 日期欄位是 `date`("YYYY-MM-DD"),所有日期運算都在字串 / UTC 上做,不碰伺服器時區。
 */

export type ShiftTemplate = {
  id: string;
  name: string;
  short_name: string;
  /** HH:MM */
  start_time: string;
  /** HH:MM;<= start_time 代表跨日 */
  end_time: string;
  break_minutes: number;
  company: string | null;
  sort_order: number;
  is_active: boolean;
};

export type ScheduleEntry = {
  id: string;
  user_id: string;
  /** YYYY-MM-DD */
  work_date: string;
  shift_template_id: string | null;
  start_time: string | null;
  end_time: string | null;
  case_id: string | null;
  note: string | null;
};

/** "08:00:00" / "08:00" → "08:00";不合法回原字串 */
export function normalizeTime(t: string | null | undefined): string {
  if (!t) return "";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}

export function timeToMinutes(t: string): number {
  const [h, m] = normalizeTime(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalizeTime(t));
}

/**
 * 一段班的長度(分鐘),已扣休息。end <= start 視為跨日(18:00–02:00 = 8 小時)。
 * 扣完休息若是負的回 0。
 */
export function shiftDurationMinutes(
  startTime: string,
  endTime: string,
  breakMinutes = 0,
): number {
  const s = timeToMinutes(startTime);
  let e = timeToMinutes(endTime);
  if (e <= s) e += 24 * 60;
  return Math.max(0, e - s - breakMinutes);
}

export function crossesMidnight(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) <= timeToMinutes(startTime);
}

/** 某筆班表實際的起訖與休息(範本優先,自訂時間覆寫) */
export function resolveEntryTimes(
  entry: Pick<ScheduleEntry, "shift_template_id" | "start_time" | "end_time">,
  templatesById: ReadonlyMap<string, ShiftTemplate>,
): { start: string; end: string; breakMinutes: number; template: ShiftTemplate | null } | null {
  const template = entry.shift_template_id
    ? (templatesById.get(entry.shift_template_id) ?? null)
    : null;
  const start = normalizeTime(entry.start_time) || (template ? template.start_time : "");
  const end = normalizeTime(entry.end_time) || (template ? template.end_time : "");
  if (!start || !end) return null;
  return { start, end, breakMinutes: template?.break_minutes ?? 0, template };
}

/** 格子上的短標籤:範本短名,自訂時間就顯示「08–17」 */
export function entryChipLabel(
  entry: Pick<ScheduleEntry, "shift_template_id" | "start_time" | "end_time">,
  templatesById: ReadonlyMap<string, ShiftTemplate>,
): string {
  const t = resolveEntryTimes(entry, templatesById);
  if (!t) return "?";
  if (t.template && !entry.start_time && !entry.end_time) return t.template.short_name;
  return `${t.start.slice(0, 2)}–${t.end.slice(0, 2)}`;
}

/** 「日班 08:00–17:00」/「自訂 09:00–15:00」 */
export function describeEntry(
  entry: Pick<ScheduleEntry, "shift_template_id" | "start_time" | "end_time">,
  templatesById: ReadonlyMap<string, ShiftTemplate>,
): string {
  const t = resolveEntryTimes(entry, templatesById);
  if (!t) return "（班別已移除）";
  const name = t.template ? t.template.name : "自訂";
  return `${name} ${t.start}–${t.end}${crossesMidnight(t.start, t.end) ? "（跨日）" : ""}`;
}

/* ---------------- 日期(YYYY-MM-DD 字串運算) ---------------- */

export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 該週的週一 */
export function weekStartOf(dateIso: string): string {
  return addDays(dateIso, -(isoWeekday(dateIso) - 1));
}

/** 週一起連續 7 天 */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}

/** "9/28" 這種短日期(格子表頭用) */
export function shortDateLabel(dateIso: string): string {
  const [, m, d] = dateIso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 把一批班表依 user_id → work_date 分組 */
export function groupEntries(
  entries: readonly ScheduleEntry[],
): Map<string, Map<string, ScheduleEntry[]>> {
  const byUser = new Map<string, Map<string, ScheduleEntry[]>>();
  for (const e of entries) {
    let byDate = byUser.get(e.user_id);
    if (!byDate) byUser.set(e.user_id, (byDate = new Map()));
    const list = byDate.get(e.work_date);
    if (list) list.push(e);
    else byDate.set(e.work_date, [e]);
  }
  return byUser;
}

export function indexTemplates(rows: readonly ShiftTemplate[]): Map<string, ShiftTemplate> {
  const m = new Map<string, ShiftTemplate>();
  for (const r of rows) m.set(r.id, r);
  return m;
}
