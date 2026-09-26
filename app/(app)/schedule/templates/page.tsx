import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetActor } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { normalizeTime, type ShiftTemplate } from "@/lib/payroll/schedule";
import { NextStepHint } from "@/components/next-step-hint";
import { TemplatesManager } from "./templates-manager";

export const dynamic = "force-dynamic";

/** 班別範本(office_staff / owner)。裕民只有日班;餐飲分公司會有早 / 午 / 晚班。 */
export default async function ShiftTemplatesPage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "office_staff" && actor.role !== "owner") redirect("/");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shift_templates")
    .select("id, name, short_name, start_time, end_time, break_minutes, company, sort_order, is_active")
    .order("is_active", { ascending: false })
    .order("sort_order")
    .order("created_at");

  const rows: ShiftTemplate[] = (data ?? []).map((t) => ({
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

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/payroll" className="hover:text-accent">薪資</Link>
        <span className="mx-1.5">／</span>
        <Link href="/schedule" className="hover:text-accent">排班</Link>
        <span className="mx-1.5">／</span>
        <span>班別範本</span>
      </nav>
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">班別範本</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        排班時從這裡選。下班時間早於上班時間代表跨日班(例如晚班 18:00–02:00)。休息時間會從工時裡扣掉。
      </p>

      {error ? (
        <NextStepHint tone="warning" title="排班資料表還沒建立">
          migration-2.41 尚未在資料庫執行,先跟 Evelyn 說一聲。
        </NextStepHint>
      ) : (
        <TemplatesManager rows={rows} />
      )}
    </div>
  );
}
