import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetActor } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { todayLocalDate } from "@/lib/daily-log";
import {
  addDays,
  isIsoDate,
  normalizeTime,
  weekDates,
  weekStartOf,
  type ScheduleEntry,
  type ShiftTemplate,
} from "@/lib/payroll/schedule";
import type { Holiday } from "@/lib/payroll/holidays";
import { loadStaffDirectory } from "@/lib/staff-directory";
import { NextStepHint } from "@/components/next-step-hint";
import { ScheduleGrid, type CaseOpt } from "./schedule-grid";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ week?: string }>;

/**
 * /schedule 週曆(週一起)。
 * office_staff / owner 可編輯;site_supervisor 唯讀(看工班誰在哪個工地);其他角色回首頁
 * (工人在打卡頁看自己的「本週班表」卡)。
 */
export default async function SchedulePage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  const canEdit = actor.role === "office_staff" || actor.role === "owner";
  if (!canEdit && actor.role !== "site_supervisor") redirect("/");

  const sp = await searchParams;
  const today = todayLocalDate();
  const weekStart = isIsoDate(sp.week) ? weekStartOf(sp.week) : weekStartOf(today);
  const dates = weekDates(weekStart);

  const supabase = await createClient();
  const [staff, tplRes, entryRes, caseRes, holidayRes, dayOffRes] = await Promise.all([
    // 人員列走 service role(上面已擋掉其他角色):主任讀不到別人的 profile(RLS),
    // 用一般 client 撈,主任的唯讀班表只剩自己一列。班表 / 排休本身主任讀得到全部。
    loadStaffDirectory({
      roles: ["site_supervisor", "field_assistant", "office_staff", "owner"],
      activeOnly: true,
    }),
    supabase
      .from("shift_templates")
      .select("id, name, short_name, start_time, end_time, break_minutes, company, sort_order, is_active")
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("schedule_entries")
      .select("id, user_id, work_date, shift_template_id, start_time, end_time, case_id, note")
      .gte("work_date", dates[0])
      .lte("work_date", dates[6]),
    supabase
      .from("cases")
      .select("id, code, name, status")
      .in("status", ["active", "paused"])
      .order("status")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("holidays")
      .select("holiday_date, name, is_workday")
      .gte("holiday_date", dates[0])
      .lte("holiday_date", dates[6]),
    // 排休(migration-2.42;表不存在時 data 為 null → 沒有人排休)
    supabase
      .from("day_off_requests")
      .select("user_id, off_date, note")
      .gte("off_date", dates[0])
      .lte("off_date", dates[6]),
  ]);
  const dayOffs = (dayOffRes.data ?? []).map((r) => ({
    userId: r.user_id as string,
    date: r.off_date as string,
    note: (r.note as string | null) ?? null,
  }));

  const tableMissing = !!tplRes.error || !!entryRes.error;

  const templates: ShiftTemplate[] = (tplRes.data ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    short_name: t.short_name as string,
    start_time: normalizeTime(t.start_time as string),
    end_time: normalizeTime(t.end_time as string),
    break_minutes: t.break_minutes as number,
    company: (t.company as string | null) ?? null,
    sort_order: t.sort_order as number,
    is_active: t.is_active as boolean,
  }));
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
  const cases: CaseOpt[] = (caseRes.data ?? []).map((c) => ({
    id: c.id as string,
    label: (c.code ? `${c.code}｜` : "") + (c.name as string),
    paused: c.status === "paused",
  }));
  const holidays: Holiday[] = (holidayRes.data ?? []) as Holiday[];

  return (
    <div className="mx-auto max-w-7xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/payroll" className="hover:text-accent">薪資</Link>
        <span className="mx-1.5">／</span>
        <span>排班</span>
      </nav>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">排班表</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {canEdit
              ? "點格子排班。遲到判定與季獎金的滿勤天數都以這張表為準。"
              : "唯讀。工班的排班由辦公室安排。"}
          </p>
        </div>
        {canEdit && (
          <Link
            href="/schedule/templates"
            className="text-sm text-primary underline-offset-4 hover:text-accent hover:underline"
          >
            班別範本（{templates.filter((t) => t.is_active).length}）→
          </Link>
        )}
      </div>

      {tableMissing ? (
        <NextStepHint tone="warning" title="排班資料表還沒建立">
          migration-2.41 尚未在資料庫執行,先跟 Evelyn 說一聲。
        </NextStepHint>
      ) : (
        <ScheduleGrid
          weekStart={weekStart}
          prevWeek={addDays(weekStart, -7)}
          nextWeek={addDays(weekStart, 7)}
          thisWeek={weekStartOf(today)}
          today={today}
          staff={staff}
          templates={templates}
          entries={entries}
          cases={cases}
          holidays={holidays}
          dayOffs={dayOffs}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
