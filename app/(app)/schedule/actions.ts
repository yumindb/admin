"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { createServiceClient } from "@/lib/supabase/server";
import {
  addDays,
  isIsoDate,
  isValidTime,
  normalizeTime,
  weekDates,
} from "@/lib/payroll/schedule";
import type { PayrollActionResult } from "../payroll/types";

/**
 * 排班(Phase B)的 server actions。寫入一律 office_staff / owner + service-role
 * (shift_templates / schedule_entries 都沒開 INSERT / UPDATE / DELETE policy)。
 */

function fail(error: string, fieldErrors?: Record<string, string[]>): PayrollActionResult {
  return { ok: false, error, fieldErrors };
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

async function requireScheduler(): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const actor = await requireRole(["office_staff", "owner"]);
    return { ok: true, id: actor.id };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "只有辦公室助理或核定人可以排班") };
  }
}

function revalidateSchedule() {
  revalidatePath("/schedule");
  revalidatePath("/schedule/templates");
  revalidatePath("/attendance");
}

const timeSchema = z
  .string()
  .transform((s) => normalizeTime(s))
  .refine((s) => isValidTime(s), "時間格式要是 HH:MM");

/* ------------------------------------------------------------------ */
/* 班別範本                                                            */
/* ------------------------------------------------------------------ */

const TemplateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "名稱必填").max(30),
  shortName: z.string().trim().min(1, "短名必填").max(2, "短名最多 2 個字"),
  startTime: timeSchema,
  endTime: timeSchema,
  breakMinutes: z.number().int().min(0).max(240),
});

export async function saveShiftTemplateAction(
  input: z.input<typeof TemplateSchema>,
): Promise<PayrollActionResult> {
  const auth = await requireScheduler();
  if (!auth.ok) return fail(auth.error);

  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("有欄位填得不對", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  const d = parsed.data;
  if (d.startTime === d.endTime) {
    return fail("起訖時間不能一樣", { endTime: ["起訖時間不能一樣"] });
  }

  const admin = createServiceClient();
  const row = {
    name: d.name,
    short_name: d.shortName,
    start_time: d.startTime,
    end_time: d.endTime,
    break_minutes: d.breakMinutes,
  };
  const res = d.id
    ? await admin.from("shift_templates").update(row).eq("id", d.id)
    : await admin.from("shift_templates").insert({ ...row, created_by: auth.id });
  if (res.error) {
    if (res.error.code === "42P01" || res.error.code === "PGRST205") {
      return fail("排班資料表還沒建立(migration-2.41 尚未執行),請先跟 Evelyn 說");
    }
    return fail("儲存失敗:" + res.error.message);
  }
  revalidateSchedule();
  return { ok: true };
}

export async function setShiftTemplateActiveAction(input: {
  id: string;
  isActive: boolean;
}): Promise<PayrollActionResult> {
  const auth = await requireScheduler();
  if (!auth.ok) return fail(auth.error);
  const parsed = z.object({ id: z.string().uuid(), isActive: z.boolean() }).safeParse(input);
  if (!parsed.success) return fail("輸入格式錯誤");

  const admin = createServiceClient();
  const { error } = await admin
    .from("shift_templates")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.id);
  if (error) return fail("儲存失敗:" + error.message);
  revalidateSchedule();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 某人某天的班(整天覆寫)                                                */
/* ------------------------------------------------------------------ */

const DayEntrySchema = z
  .object({
    shiftTemplateId: z.string().uuid().nullable().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    caseId: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.shiftTemplateId) return;
    if (!v.startTime || !isValidTime(v.startTime) || !v.endTime || !isValidTime(v.endTime)) {
      ctx.addIssue({ code: "custom", message: "自訂班要填起訖時間(HH:MM)", path: ["startTime"] });
    }
  });

const DaySchema = z.object({
  userId: z.string().uuid(),
  workDate: z.string().refine(isIsoDate, "日期格式錯誤"),
  entries: z.array(DayEntrySchema).max(4, "一天最多 4 段"),
  note: z.string().trim().max(120).optional().or(z.literal("")),
});

/**
 * 設定某人某天的班:整天覆寫(先刪再寫)。entries 空陣列 = 清掉那天。
 * 一天多筆 = 兩頭班;同一班別 / 同一起始時間重複的會自動去掉。
 */
export async function setDayScheduleAction(
  input: z.input<typeof DaySchema>,
): Promise<PayrollActionResult> {
  const auth = await requireScheduler();
  if (!auth.ok) return fail(auth.error);

  const parsed = DaySchema.safeParse(input);
  if (!parsed.success) {
    return fail("有欄位填得不對", parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  const d = parsed.data;
  const admin = createServiceClient();

  // 範本要存在且啟用
  const templateIds = Array.from(
    new Set(d.entries.map((e) => e.shiftTemplateId).filter((x): x is string => !!x)),
  );
  if (templateIds.length > 0) {
    const { data: tpl, error } = await admin
      .from("shift_templates")
      .select("id, is_active")
      .in("id", templateIds);
    if (error) return fail("讀取班別失敗:" + error.message);
    const active = new Set((tpl ?? []).filter((t) => t.is_active).map((t) => t.id as string));
    if (templateIds.some((id) => !active.has(id))) return fail("有班別已停用或不存在,請重新選");
  }

  const seen = new Set<string>();
  const rows = d.entries
    .map((e) => ({
      user_id: d.userId,
      work_date: d.workDate,
      shift_template_id: e.shiftTemplateId ?? null,
      start_time: e.shiftTemplateId ? null : normalizeTime(e.startTime),
      end_time: e.shiftTemplateId ? null : normalizeTime(e.endTime),
      case_id: e.caseId ?? null,
      note: d.note ? d.note : null,
      created_by: auth.id,
    }))
    .filter((r) => {
      const key = `${r.shift_template_id ?? "custom"}|${r.start_time ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const del = await admin
    .from("schedule_entries")
    .delete()
    .eq("user_id", d.userId)
    .eq("work_date", d.workDate);
  if (del.error) {
    if (del.error.code === "42P01" || del.error.code === "PGRST205") {
      return fail("排班資料表還沒建立(migration-2.41 尚未執行),請先跟 Evelyn 說");
    }
    return fail("儲存失敗:" + del.error.message);
  }
  if (rows.length > 0) {
    const ins = await admin.from("schedule_entries").insert(rows);
    if (ins.error) return fail("儲存失敗:" + ins.error.message);
  }

  revalidateSchedule();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 整週操作                                                            */
/* ------------------------------------------------------------------ */

const WeekFillSchema = z.object({
  weekStart: z.string().refine(isIsoDate, "日期格式錯誤"),
  shiftTemplateId: z.string().uuid(),
  /** ISO 星期 1–7 */
  weekdays: z.array(z.number().int().min(1).max(7)).min(1),
  userIds: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * 快速排班:把某個班別填進這些人、這些星期幾 — **只填還沒排的日子**,已排的與本人排休的都不動。
 * 裕民每週一次「全員週一到週五日班」就靠這個。
 */
export async function fillWeekScheduleAction(
  input: z.input<typeof WeekFillSchema>,
): Promise<PayrollActionResult & { inserted?: number }> {
  const auth = await requireScheduler();
  if (!auth.ok) return fail(auth.error);
  const parsed = WeekFillSchema.safeParse(input);
  if (!parsed.success) return fail("輸入格式錯誤");
  const d = parsed.data;

  const admin = createServiceClient();
  const { data: tpl, error: tplErr } = await admin
    .from("shift_templates")
    .select("id, is_active")
    .eq("id", d.shiftTemplateId)
    .maybeSingle();
  if (tplErr) return fail("讀取班別失敗:" + tplErr.message);
  if (!tpl || !tpl.is_active) return fail("班別已停用或不存在");

  const dates = weekDates(d.weekStart).filter((_, i) => d.weekdays.includes(i + 1));
  const [{ data: existing, error: exErr }, dayOffRes] = await Promise.all([
    admin
      .from("schedule_entries")
      .select("user_id, work_date")
      .in("user_id", d.userIds)
      .in("work_date", dates),
    // 排休的日子也跳過(表不存在時當沒有人排休)
    admin
      .from("day_off_requests")
      .select("user_id, off_date")
      .in("user_id", d.userIds)
      .in("off_date", dates),
  ]);
  if (exErr) return fail("讀取班表失敗:" + exErr.message);
  const taken = new Set((existing ?? []).map((e) => `${e.user_id}|${e.work_date}`));
  for (const r of dayOffRes.data ?? []) taken.add(`${r.user_id}|${r.off_date}`);

  const rows = [];
  for (const userId of d.userIds) {
    for (const date of dates) {
      if (taken.has(`${userId}|${date}`)) continue;
      rows.push({
        user_id: userId,
        work_date: date,
        shift_template_id: d.shiftTemplateId,
        created_by: auth.id,
      });
    }
  }
  if (rows.length > 0) {
    const ins = await admin.from("schedule_entries").insert(rows);
    if (ins.error) return fail("儲存失敗:" + ins.error.message);
  }
  revalidateSchedule();
  return { ok: true, inserted: rows.length };
}

const CopyWeekSchema = z.object({
  fromWeekStart: z.string().refine(isIsoDate, "日期格式錯誤"),
  toWeekStart: z.string().refine(isIsoDate, "日期格式錯誤"),
});

/**
 * 複製整週:來源週有排班的人,目標週**整週覆寫**成一樣的;來源週沒排的人不動。
 */
export async function copyWeekScheduleAction(
  input: z.input<typeof CopyWeekSchema>,
): Promise<PayrollActionResult & { copied?: number; users?: number }> {
  const auth = await requireScheduler();
  if (!auth.ok) return fail(auth.error);
  const parsed = CopyWeekSchema.safeParse(input);
  if (!parsed.success) return fail("輸入格式錯誤");
  const { fromWeekStart, toWeekStart } = parsed.data;
  if (fromWeekStart === toWeekStart) return fail("來源週和目標週一樣");

  const admin = createServiceClient();
  const fromDates = weekDates(fromWeekStart);
  const { data: source, error: srcErr } = await admin
    .from("schedule_entries")
    .select("user_id, work_date, shift_template_id, start_time, end_time, case_id, note")
    .in("work_date", fromDates);
  if (srcErr) return fail("讀取來源週失敗:" + srcErr.message);
  if (!source || source.length === 0) return fail("來源週沒有任何排班,沒東西可複製");

  const userIds = Array.from(new Set(source.map((e) => e.user_id as string)));
  const offset = Math.round(
    (new Date(`${toWeekStart}T00:00:00Z`).getTime() - new Date(`${fromWeekStart}T00:00:00Z`).getTime()) /
      86_400_000,
  );

  const del = await admin
    .from("schedule_entries")
    .delete()
    .in("user_id", userIds)
    .in("work_date", weekDates(toWeekStart));
  if (del.error) return fail("清目標週失敗:" + del.error.message);

  const rows = source.map((e) => ({
    user_id: e.user_id as string,
    work_date: addDays(e.work_date as string, offset),
    shift_template_id: (e.shift_template_id as string | null) ?? null,
    start_time: (e.start_time as string | null) ?? null,
    end_time: (e.end_time as string | null) ?? null,
    case_id: (e.case_id as string | null) ?? null,
    note: (e.note as string | null) ?? null,
    created_by: auth.id,
  }));
  const ins = await admin.from("schedule_entries").insert(rows);
  if (ins.error) return fail("寫入目標週失敗:" + ins.error.message);

  revalidateSchedule();
  return { ok: true, copied: rows.length, users: userIds.length };
}
