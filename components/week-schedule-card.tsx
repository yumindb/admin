import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { todayLocalDate } from "@/lib/daily-log";
import { WEEKDAY_LABEL } from "@/lib/payroll/settings";
import { isoWeekday } from "@/lib/payroll/holidays";
import {
  describeEntry,
  indexTemplates,
  normalizeTime,
  shortDateLabel,
  weekDates,
  weekStartOf,
  type ScheduleEntry,
  type ShiftTemplate,
} from "@/lib/payroll/schedule";

/**
 * 「本週班表」唯讀卡(打卡頁用)。工人 / 主任的手機不加第六個 tab,
 * 班表就放在他們每天都會開的打卡頁。只查本人這一週(單人單週,量極小)。
 * 表不存在(migration-2.41 沒跑)→ 什麼都不顯示。
 */
export async function WeekScheduleCard({ userId }: { userId: string }) {
  const supabase = await createClient();
  const today = todayLocalDate();
  const dates = weekDates(weekStartOf(today));

  const [entryRes, tplRes] = await Promise.all([
    supabase
      .from("schedule_entries")
      .select("id, user_id, work_date, shift_template_id, start_time, end_time, case_id, note")
      .eq("user_id", userId)
      .gte("work_date", dates[0])
      .lte("work_date", dates[6])
      .order("work_date"),
    supabase
      .from("shift_templates")
      .select("id, name, short_name, start_time, end_time, break_minutes, company, sort_order, is_active"),
  ]);
  if (entryRes.error || tplRes.error) return null;

  const entries: ScheduleEntry[] = (entryRes.data ?? []).map((e) => ({
    id: e.id as string,
    user_id: e.user_id as string,
    work_date: e.work_date as string,
    shift_template_id: (e.shift_template_id as string | null) ?? null,
    start_time: normalizeTime(e.start_time as string | null) || null,
    end_time: normalizeTime(e.end_time as string | null) || null,
    case_id: (e.case_id as string | null) ?? null,
    note: (e.note as string | null) ?? null,
  }));
  if (entries.length === 0) return null;

  const templatesById = indexTemplates(
    (tplRes.data ?? []).map((t) => ({
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

  const caseIds = Array.from(new Set(entries.map((e) => e.case_id).filter((c): c is string => !!c)));
  const caseLabel = new Map<string, string>();
  if (caseIds.length > 0) {
    const { data } = await supabase.from("cases").select("id, code, name").in("id", caseIds);
    for (const c of data ?? []) {
      caseLabel.set(c.id as string, (c.code ? `${c.code}｜` : "") + (c.name as string));
    }
  }

  const byDate = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.work_date);
    if (list) list.push(e);
    else byDate.set(e.work_date, [e]);
  }

  return (
    <section className="mt-6 rounded-md border border-[#E0DCD6] bg-card">
      <div className="flex items-center gap-2 border-b border-[#F0EBE4] px-4 py-3">
        <CalendarDays className="size-4 text-primary" strokeWidth={1.75} />
        <h2 className="text-base font-semibold text-primary">本週班表</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {shortDateLabel(dates[0])}–{shortDateLabel(dates[6])}
        </span>
      </div>
      <ul className="divide-y divide-[#F0EBE4]">
        {dates.map((d) => {
          const list = byDate.get(d) ?? [];
          const isToday = d === today;
          return (
            <li key={d} className={`flex items-start gap-3 px-4 py-2 text-sm ${isToday ? "bg-[#F5F1EC]/60" : ""}`}>
              <span className={`w-16 shrink-0 ${isToday ? "font-semibold text-accent" : "text-muted-foreground"}`}>
                {WEEKDAY_LABEL[isoWeekday(d)]} {shortDateLabel(d)}
              </span>
              <span className="min-w-0 flex-1">
                {list.length === 0 ? (
                  <span className="text-muted-foreground/70">休</span>
                ) : (
                  list.map((e) => (
                    <span key={e.id} className="block">
                      <span className="text-foreground">{describeEntry(e, templatesById)}</span>
                      {e.case_id && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{caseLabel.get(e.case_id) ?? ""}</span>
                      )}
                      {e.note && <span className="ml-1.5 text-xs text-muted-foreground">{e.note}</span>}
                    </span>
                  ))
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
