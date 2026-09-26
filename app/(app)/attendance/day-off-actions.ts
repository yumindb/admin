"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActor } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { todayLocalDate } from "@/lib/daily-log";
import { dayOffBlockedReason, loadPayrollSettings } from "@/lib/payroll/settings";
import { isIsoDate } from "@/lib/payroll/schedule";
import type { PayrollActionResult } from "../payroll/types";

/**
 * 排休(migration-2.42):本人標 / 取消自己的「這天不能上」。
 * 走 RLS 生效的 client(policy 只准本人寫自己的),server 端再守規則:
 *   - 排休功能開著
 *   - 日期不能是過去 / 太近、沒過截止日(payroll.day_off)
 *   - 那天還沒被排班(已排班要改就走請假)
 *   - 每月上限
 */
export async function toggleDayOffAction(input: {
  date: string;
  on: boolean;
  note?: string;
}): Promise<PayrollActionResult> {
  let actorId: string;
  try {
    actorId = (await getActor()).id;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "請先登入" };
  }
  const parsed = z
    .object({
      date: z.string().refine(isIsoDate, "日期格式錯誤"),
      on: z.boolean(),
      note: z.string().trim().max(60).optional().or(z.literal("")),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "輸入格式錯誤" };
  const { date, on, note } = parsed.data;

  const supabase = await createClient();

  if (!on) {
    const { error } = await supabase
      .from("day_off_requests")
      .delete()
      .eq("user_id", actorId)
      .eq("off_date", date);
    if (error) return { ok: false, error: "取消失敗:" + error.message };
    revalidatePath("/attendance");
    revalidatePath("/schedule");
    return { ok: true };
  }

  const settings = await loadPayrollSettings(supabase);
  const rules = settings.day_off;
  if (!rules.enabled) return { ok: false, error: "排休功能目前沒有開放" };

  const today = todayLocalDate();
  const blocked = dayOffBlockedReason(date, today, rules);
  if (blocked) return { ok: false, error: blocked };

  const [{ data: scheduled, error: schedErr }, { count, error: countErr }] = await Promise.all([
    supabase
      .from("schedule_entries")
      .select("id")
      .eq("user_id", actorId)
      .eq("work_date", date)
      .limit(1),
    rules.monthly_cap > 0
      ? supabase
          .from("day_off_requests")
          .select("off_date", { count: "exact", head: true })
          .eq("user_id", actorId)
          .gte("off_date", `${date.slice(0, 7)}-01`)
          .lte("off_date", `${date.slice(0, 7)}-31`)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (schedErr) return { ok: false, error: "讀取班表失敗:" + schedErr.message };
  if ((scheduled ?? []).length > 0) {
    return { ok: false, error: "這天已經排班了,要休的話請走請假" };
  }
  if (countErr) return { ok: false, error: "讀取排休失敗:" + countErr.message };
  if (rules.monthly_cap > 0 && (count ?? 0) >= rules.monthly_cap) {
    return { ok: false, error: `這個月最多只能標 ${rules.monthly_cap} 天排休` };
  }

  const { error } = await supabase.from("day_off_requests").upsert(
    { user_id: actorId, off_date: date, note: note ? note : null },
    { onConflict: "user_id,off_date" },
  );
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { ok: false, error: "排休功能還沒建好(migration-2.42 尚未執行)" };
    }
    return { ok: false, error: "儲存失敗:" + error.message };
  }
  revalidatePath("/attendance");
  revalidatePath("/schedule");
  return { ok: true };
}
