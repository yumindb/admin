import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetActor } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { canEditPayrollRules } from "@/lib/payroll/access";
import type { Holiday } from "@/lib/payroll/holidays";
import { todayLocalDate } from "@/lib/daily-log";
import { NextStepHint } from "@/components/next-step-hint";
import { HolidaysManager } from "./holidays-manager";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ year?: string }>;

/**
 * 假日行事曆(office_staff / owner)。
 * 只放「實際放假的平日」— 假日落在週六日時放補假那天;週六日本身由薪資規則決定是休息日 / 例假日。
 */
export default async function HolidaysPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (!canEditPayrollRules(actor.role)) redirect("/");

  const sp = await searchParams;
  const thisYear = Number(todayLocalDate().slice(0, 4));
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : thisYear;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("holidays")
    .select("holiday_date, name, is_workday")
    .gte("holiday_date", `${year}-01-01`)
    .lte("holiday_date", `${year}-12-31`)
    .order("holiday_date");

  const rows = (data ?? []) as Holiday[];

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/payroll" className="hover:text-accent">薪資</Link>
        <span className="mx-1.5">／</span>
        <span>假日行事曆</span>
      </nav>
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">假日行事曆</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        國定假日、補假、補班日。這天出勤照「例假日 / 國定假日」倍率算,也不列入季獎金的應到天數。
      </p>

      {error ? (
        <NextStepHint tone="warning" title="假日資料表還沒建立">
          migration-2.40 尚未在資料庫執行,先跟 Evelyn 說一聲。
        </NextStepHint>
      ) : (
        <>
          <NextStepHint tone="muted" className="mb-5">
            2026 年的假日已依人事行政總處行事曆先填好,請對一次。每年年底把下一年的加進來;
            週六、週日不用填(它們本來就是休息日 / 例假日),只填落在平日的假,或週末要上班的補班日。
          </NextStepHint>
          <HolidaysManager year={year} thisYear={thisYear} rows={rows} />
        </>
      )}
    </div>
  );
}
