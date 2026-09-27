import Link from "next/link";
import { redirect } from "next/navigation";
import { tryGetActor } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { todayLocalDate } from "@/lib/daily-log";
import { isMonthKey, loadWorkHours, monthRange } from "@/lib/payroll/work-hours-data";
import { NextStepHint } from "@/components/next-step-hint";
import { WorkHoursClient } from "./client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ month?: string; user?: string }>;

/**
 * 工時對帳(Phase C):打卡 → 工作段 → 正常 / 加班 / 假日時數,對排班算遲到早退缺勤,列異常。
 * office_staff / owner。只有時數沒有金額,所以不需要薪資權限;月結(Phase D)才乘時薪。
 */
export default async function WorkHoursReportPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "office_staff" && actor.role !== "owner") redirect("/");

  const sp = await searchParams;
  const month = isMonthKey(sp.month) ? sp.month : todayLocalDate().slice(0, 7);
  const userId = sp.user && /^[0-9a-f-]{36}$/.test(sp.user) ? sp.user : null;
  const { from, to } = monthRange(month);

  const supabase = await createClient();
  const report = await loadWorkHours(supabase, { from, to });
  const selected = userId ? report.people.find((p) => p.user.id === userId) ?? null : null;

  return (
    <div className="mx-auto max-w-6xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/reports" className="hover:text-accent">報表</Link>
        <span className="mx-1.5">／</span>
        <span>工時對帳</span>
      </nav>
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">工時對帳</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        把打卡配對成工作段,扣休息、對排班,拆成正常工時、分段加班、假日出勤;漏卡與缺勤列在最上面。
        這裡只有時數,金額在月結。
      </p>

      {report.missingTables.length > 0 && (
        <NextStepHint tone="warning" title="部分資料表還沒建立" className="mb-4">
          {report.missingTables.join("、")} 不存在(migration 尚未執行),先當作沒有排班 / 假日來算。
        </NextStepHint>
      )}
      {report.truncated && (
        <NextStepHint tone="warning" title="打卡筆數超過上限" className="mb-4">
          這個月的打卡超過 5 萬筆,只算了前面的部分。請縮小範圍或跟 Evelyn 說。
        </NextStepHint>
      )}

      <WorkHoursClient month={month} from={from} to={to} people={report.people} selected={selected} settings={report.settings} />
    </div>
  );
}
