import { createClient } from "@/lib/supabase/server";
import { todayLocalDate } from "@/lib/daily-log";
import { loadPayrollSettings } from "@/lib/payroll/settings";
import { addDays } from "@/lib/payroll/schedule";
import { DayOffCard } from "./day-off-card";

/**
 * 「排休」卡的資料層(server component)。打卡頁用。
 * 只查本人:今天起 62 天內的排休 + 已排班日期(已排班的日子不能標排休)。
 * 表不存在 / 功能關閉 → 不顯示。
 */
export async function DayOffSection({ userId }: { userId: string }) {
  const supabase = await createClient();
  const today = todayLocalDate();
  const until = addDays(today, 62);

  const [settings, offRes, schedRes] = await Promise.all([
    loadPayrollSettings(supabase),
    supabase
      .from("day_off_requests")
      .select("off_date, note")
      .eq("user_id", userId)
      .gte("off_date", today)
      .lte("off_date", until),
    supabase
      .from("schedule_entries")
      .select("work_date")
      .eq("user_id", userId)
      .gte("work_date", today)
      .lte("work_date", until),
  ]);
  if (!settings.day_off.enabled || offRes.error) return null;

  return (
    <DayOffCard
      today={today}
      offDates={(offRes.data ?? []).map((r) => r.off_date as string)}
      scheduledDates={Array.from(new Set((schedRes.data ?? []).map((r) => r.work_date as string)))}
      rules={settings.day_off}
    />
  );
}
