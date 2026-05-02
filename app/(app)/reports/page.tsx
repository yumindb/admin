import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BarChart3,
  FileWarning,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { tryGetActor } from "@/lib/auth/require-role";

/**
 * /reports 入口頁。提供 4 張 card link:
 *   - 跨案工項累計
 *   - 本月超工 / 未簽約
 *   - 案件進度總覽
 *   - 簽核延遲分析(coming soon)
 *
 * 角色:office_staff / owner / site_supervisor 可進。field_assistant 直接 redirect 回首頁。
 */
export default async function ReportsHomePage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role === "field_assistant") redirect("/");

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">報表</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          跨案件統計、月底盤點、進度總覽 — 協助管理層掌握全公司施工狀況
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ReportCard
          href="/reports/work-items"
          title="工項累計(跨案)"
          description="所有案件的工項施工進度,可篩選案件、工項名稱、完成度區間,並下載 Excel"
          icon={<BarChart3 className="size-6" strokeWidth={1.75} />}
        />
        <ReportCard
          href="/reports/unsigned"
          title="本月超工 / 未簽約"
          description="日誌中登記的合約外、未簽約項目清單。月底用來核對追加報價"
          icon={<FileWarning className="size-6" strokeWidth={1.75} />}
        />
        <ReportCard
          href="/reports/cases-overview"
          title="案件進度總覽"
          description="所有案件的進度 %、累計日誌、落後標記。可依進度、開工日期排序"
          icon={<ListChecks className="size-6" strokeWidth={1.75} />}
        />
        <ReportCard
          href="#"
          title="簽核延遲分析"
          description="日誌從填表到核定的平均工時、最久未處理的待簽 — 協助辨識瓶頸"
          icon={<ShieldCheck className="size-6" strokeWidth={1.75} />}
          comingSoon
        />
      </div>
    </div>
  );
}

function ReportCard({
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
        <h3 className="text-lg font-semibold text-primary group-hover:text-accent">
          {title}
        </h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}
