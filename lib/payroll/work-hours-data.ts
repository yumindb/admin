import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/db/fetch-all";
import type { LeaveType } from "@/lib/types";
import { indexHolidays, type Holiday } from "./holidays";
import {
  addDays,
  indexTemplates,
  normalizeTime,
  type ScheduleEntry,
  type ShiftTemplate,
} from "./schedule";
import { loadPayrollSettings, type PayrollSettings } from "./settings";
import {
  computeWorkHours,
  type DayResult,
  type LeaveSpan,
  type WorkEvent,
  type WorkHoursSummary,
} from "./work-hours";

/**
 * 工時對帳的資料層:把一段期間內所有人的打卡、班表、假日、假單撈齊,餵給 computeWorkHours。
 *
 * 用 RLS 生效的 client(呼叫端已限定 office_staff / owner):打卡 read-all、班表與假單這兩個角色都讀得到。
 * 表不存在(migration 沒跑)不會炸:回 missingTables 讓頁面提示,其餘照算。
 *
 * 量:一個月 ~25 人 × 2 卡 × 22 天 ≈ 1,100 筆打卡,走 fetchAllRows 避免 1000 筆截斷。
 */

export type PersonWorkHours = {
  user: { id: string; full_name: string; role: string };
  days: DayResult[];
  summary: WorkHoursSummary;
};

export type WorkHoursReport = {
  from: string;
  to: string;
  people: PersonWorkHours[];
  settings: PayrollSettings;
  missingTables: string[];
  truncated: boolean;
};

const ROLE_ORDER = ["site_supervisor", "field_assistant", "office_staff", "owner"];

export async function loadWorkHours(
  supabase: SupabaseClient,
  opts: { from: string; to: string; userIds?: string[] },
): Promise<WorkHoursReport> {
  const { from, to } = opts;
  const fromIso = `${from}T00:00:00+08:00`;
  // 跨午夜的下班卡在隔天,多抓半天
  const toIsoWide = `${addDays(to, 1)}T12:00:00+08:00`;
  const toIsoEnd = `${addDays(to, 1)}T00:00:00+08:00`;
  const missingTables: string[] = [];

  let profileQuery = supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("is_active", true)
    .neq("role", "reviewer");
  if (opts.userIds && opts.userIds.length > 0) profileQuery = profileQuery.in("id", opts.userIds);

  const eventQuery = (lo: number, hi: number) => {
    let q = supabase
      .from("attendance_events")
      .select("id, user_id, event_type, created_at, case_id, source")
      .gte("created_at", fromIso)
      .lte("created_at", toIsoWide)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(lo, hi);
    if (opts.userIds && opts.userIds.length > 0) q = q.in("user_id", opts.userIds);
    return q;
  };

  let scheduleQuery = supabase
    .from("schedule_entries")
    .select("id, user_id, work_date, shift_template_id, start_time, end_time, case_id, note")
    .gte("work_date", from)
    .lte("work_date", to);
  if (opts.userIds && opts.userIds.length > 0) scheduleQuery = scheduleQuery.in("user_id", opts.userIds);

  let leaveQuery = supabase
    .from("leave_requests")
    .select("applicant_id, leave_type, start_at, end_at, total_hours")
    .eq("status", "approved")
    .lt("start_at", toIsoEnd)
    .gt("end_at", fromIso);
  if (opts.userIds && opts.userIds.length > 0) leaveQuery = leaveQuery.in("applicant_id", opts.userIds);

  const [settings, profilesRes, eventsRes, scheduleRes, templatesRes, holidaysRes, leavesRes] = await Promise.all([
    loadPayrollSettings(supabase),
    profileQuery,
    fetchAllRows<{ id: string; user_id: string; event_type: "clock_in" | "clock_out"; created_at: string; case_id: string | null; source: string | null }>(eventQuery),
    scheduleQuery,
    supabase
      .from("shift_templates")
      .select("id, name, short_name, start_time, end_time, break_minutes, company, sort_order, is_active"),
    supabase.from("holidays").select("holiday_date, name, is_workday").gte("holiday_date", from).lte("holiday_date", to),
    leaveQuery,
  ]);

  if (scheduleRes.error) missingTables.push("schedule_entries");
  if (templatesRes.error) missingTables.push("shift_templates");
  if (holidaysRes.error) missingTables.push("holidays");

  const templatesById = indexTemplates(
    (templatesRes.data ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      short_name: t.short_name as string,
      start_time: normalizeTime(t.start_time as string),
      end_time: normalizeTime(t.end_time as string),
      break_minutes: t.break_minutes as number,
      company: (t.company as string | null) ?? null,
      sort_order: t.sort_order as number,
      is_active: t.is_active as boolean,
    })) as ShiftTemplate[],
  );
  const holidaysByDate = indexHolidays((holidaysRes.data ?? []) as Holiday[]);

  const eventsByUser = new Map<string, WorkEvent[]>();
  for (const e of eventsRes.data) {
    const list = eventsByUser.get(e.user_id) ?? [];
    list.push({ id: e.id, event_type: e.event_type, created_at: e.created_at, case_id: e.case_id, source: e.source });
    eventsByUser.set(e.user_id, list);
  }
  const scheduleByUser = new Map<string, ScheduleEntry[]>();
  for (const s of scheduleRes.data ?? []) {
    const list = scheduleByUser.get(s.user_id as string) ?? [];
    list.push({
      id: s.id as string,
      user_id: s.user_id as string,
      work_date: s.work_date as string,
      shift_template_id: (s.shift_template_id as string | null) ?? null,
      start_time: normalizeTime(s.start_time as string | null) || null,
      end_time: normalizeTime(s.end_time as string | null) || null,
      case_id: (s.case_id as string | null) ?? null,
      note: (s.note as string | null) ?? null,
    });
    scheduleByUser.set(s.user_id as string, list);
  }
  const leavesByUser = new Map<string, LeaveSpan[]>();
  for (const l of leavesRes.data ?? []) {
    const list = leavesByUser.get(l.applicant_id as string) ?? [];
    list.push({
      leave_type: l.leave_type as LeaveType,
      start_at: l.start_at as string,
      end_at: l.end_at as string,
      total_hours: Number(l.total_hours),
    });
    leavesByUser.set(l.applicant_id as string, list);
  }

  const people: PersonWorkHours[] = (profilesRes.data ?? [])
    .map((p) => {
      const id = p.id as string;
      const result = computeWorkHours({
        from,
        to,
        events: eventsByUser.get(id) ?? [],
        schedule: scheduleByUser.get(id) ?? [],
        templatesById,
        holidaysByDate,
        leaves: leavesByUser.get(id) ?? [],
        settings,
      });
      return { user: { id, full_name: p.full_name as string, role: p.role as string }, ...result };
    })
    .sort((a, b) => {
      const r = ROLE_ORDER.indexOf(a.user.role) - ROLE_ORDER.indexOf(b.user.role);
      return r !== 0 ? r : a.user.full_name.localeCompare(b.user.full_name, "zh-TW");
    });

  return { from, to, people, settings, missingTables, truncated: eventsRes.truncated };
}

/** "2026-09" → { from: "2026-09-01", to: "2026-09-30" } */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1) };
}

export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}
