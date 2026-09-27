import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Banknote,
  CalendarDays,
  CalendarRange,
  Clock3,
  Settings2,
  Users,
} from "lucide-react";
import { tryGetActor } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { hasPayrollAccess } from "@/lib/payroll/access";
import {
  describePayProfile,
  payProfileOn,
  type PayProfile,
} from "@/lib/payroll/pay-profiles";
import { todayLocalDate } from "@/lib/daily-log";
import { getCompanyShort } from "@/lib/companies";
import { NextStepHint } from "@/components/next-step-hint";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "老闆",
  reviewer: "審閱人",
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  field_assistant: "現場人員",
};

/**
 * /payroll 入口:規則設定、假日行事曆、人員薪制總覽。
 * 排班(Phase B)、工時對帳(C)、月結與薪資單(D)之後掛在這裡。
 *
 * 進得來的人:office_staff / owner。薪制金額那段只給 hasPayrollAccess 的人。
 */
export default async function PayrollHomePage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "office_staff" && actor.role !== "owner") redirect("/");

  const payrollAccess = await hasPayrollAccess(actor);
  const supabase = await createClient();

  type Row = {
    id: string;
    full_name: string;
    role: string;
    company: string | null;
    current: PayProfile | null;
    upcoming: PayProfile | null;
  };
  let rows: Row[] = [];
  let tableMissing = false;

  if (payrollAccess) {
    const today = todayLocalDate();
    const [{ data: profiles }, payRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, role, company")
        .eq("is_active", true)
        .neq("role", "reviewer")
        .order("role")
        .order("full_name"),
      supabase
        .from("employee_pay_profiles")
        .select("id, user_id, employment_type, amount, effective_from, note, created_by, created_at"),
    ]);
    if (payRes.error) {
      tableMissing = true;
    }
    const byUser = new Map<string, PayProfile[]>();
    for (const p of (payRes.data ?? []) as PayProfile[]) {
      (byUser.get(p.user_id) ?? byUser.set(p.user_id, []).get(p.user_id)!).push(p);
    }
    rows = (profiles ?? []).map((p) => {
      const list = byUser.get(p.id as string) ?? [];
      const current = payProfileOn(list, today);
      const upcoming =
        list
          .filter((x) => x.effective_from > today)
          .sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1))[0] ?? null;
      return {
        id: p.id as string,
        full_name: p.full_name as string,
        role: p.role as string,
        company: p.company as string | null,
        current,
        upcoming,
      };
    });
  }

  const unsetCount = rows.filter((r) => !r.current && !r.upcoming).length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">薪資</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          薪資規則、假日行事曆、每位員工的薪制。排班與月結會接在這裡。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EntryCard
          href="/payroll/settings"
          title="薪資規則設定"
          description="正常工時、加班倍率、遲到扣款、請假給薪比例、季獎金、發薪日 — 全部在這裡改,不用改程式"
          icon={<Settings2 className="size-6" strokeWidth={1.75} />}
        />
        <EntryCard
          href="/payroll/holidays"
          title="假日行事曆"
          description="國定假日、補假、補班日。決定哪天出勤算假日倍率,也影響季獎金的滿勤天數"
          icon={<CalendarDays className="size-6" strokeWidth={1.75} />}
        />
        <EntryCard
          href="/staff"
          title="人員薪制"
          description={
            payrollAccess
              ? "到人員管理頁,每位人員卡片上的「薪制」按鈕可以設定月薪 / 日薪與生效日"
              : "設定每位人員的月薪 / 日薪。需要核定人授權「可處理薪資」才看得到金額"
          }
          icon={<Users className="size-6" strokeWidth={1.75} />}
        />
        <EntryCard
          href="/schedule"
          title="排班表"
          description="週曆排班、快速排班、複製上週;工人在打卡頁看自己的本週班表。遲到與季滿勤都以這張表為準"
          icon={<CalendarRange className="size-6" strokeWidth={1.75} />}
        />
        <EntryCard
          href="/reports/work-hours"
          title="工時對帳"
          description="打卡配對成工作段,扣休息、對排班,拆成正常 / 分段加班 / 假日時數;漏卡與缺勤列在最上面,月結前先對這張"
          icon={<Clock3 className="size-6" strokeWidth={1.75} />}
        />
        <EntryCard
          href="/payroll"
          title="月結・薪資單"
          description="下一階段:每月把工時乘上薪制產生薪資快照、季獎金、Excel;員工查自己的薪資單"
          icon={<Banknote className="size-6" strokeWidth={1.75} />}
          comingSoon
        />
      </div>

      {payrollAccess && (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-primary">
                <Banknote className="size-5" strokeWidth={1.75} />
                人員薪制總覽
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                啟用中的帳號 {rows.length} 位
                {unsetCount > 0 ? `,還有 ${unsetCount} 位沒設定薪制` : ",全部都設定好了"}。
              </p>
            </div>
            <Link
              href="/staff"
              className="text-sm text-primary underline-offset-4 hover:text-accent hover:underline"
            >
              到人員管理設定 →
            </Link>
          </div>

          {tableMissing ? (
            <NextStepHint tone="warning" title="薪制資料表還沒建立">
              migration-2.40 尚未在資料庫執行,先跟 Evelyn 說一聲。規則設定頁在那之前也只會顯示預設值。
            </NextStepHint>
          ) : (
            <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
              <table className="w-full text-sm">
                <thead className="bg-[#F5F1EC]/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">姓名</th>
                    <th className="px-4 py-2.5 font-medium">角色</th>
                    <th className="px-4 py-2.5 font-medium">公司</th>
                    <th className="px-4 py-2.5 font-medium">目前薪制</th>
                    <th className="px-4 py-2.5 font-medium">生效日</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EBE4]">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-[#F5F1EC]/40">
                      <td className="px-4 py-2.5 font-medium text-primary">{r.full_name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {ROLE_LABEL[r.role] ?? r.role}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {getCompanyShort(r.company) || "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.current ? (
                          <span className="text-foreground">{describePayProfile(r.current)}</span>
                        ) : r.upcoming ? (
                          <span className="text-muted-foreground">
                            {describePayProfile(r.upcoming)}（{r.upcoming.effective_from} 起）
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-xs text-[#92400E]">
                            未設定
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {r.current?.effective_from ?? "—"}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        沒有啟用中的人員
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!payrollAccess && (
        <NextStepHint tone="muted" className="mt-8">
          規則與假日你可以改;薪資金額、月結要由核定人在人員管理頁把你的帳號勾成「可處理薪資」才看得到。
        </NextStepHint>
      )}
    </div>
  );
}

function EntryCard({
  href,
  title,
  description,
  icon,
  comingSoon = false,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
}) {
  if (comingSoon) {
    return (
      <div className="flex items-start gap-4 rounded-lg border border-dashed border-[#E0DCD6] bg-card p-5 opacity-70">
        <div className="text-muted-foreground">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-primary">{title}</h3>
            <span className="rounded-full border border-[#E0DCD6] bg-[#F5F1EC] px-2 py-0.5 text-[11px] text-muted-foreground">
              即將推出
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-lg border border-[#E0DCD6] bg-card p-5 transition-colors hover:border-accent"
    >
      <div className="text-primary group-hover:text-accent">{icon}</div>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-semibold text-primary group-hover:text-accent">{title}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}
