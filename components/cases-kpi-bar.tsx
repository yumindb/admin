"use client";

/**
 * 案件儀表板 KPI bar — 4 張卡片橫排,手機 2x2。
 *
 * 卡片:
 *   1. 進行中案件數(active)
 *   2. 進度落後(比工期該有的進度落後 20 個百分點以上):紅色;點擊 → 套用 ?filter=behind
 *   3. 本週新日誌數(log_date >= 7 天前):點擊 → /logs?period=week
 *   4. 本月超工筆數(unsigned_items 內 category 在本月內):點擊 → /reports/unsigned
 *
 * KPI 數值由 server 端傳入(複用已撈的 cases/logs);這裡只負責呈現與導航。
 */

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TrendingUp, AlertTriangle, FileText, FileWarning } from "lucide-react";

export type CasesKpis = {
  activeCount: number;
  behindCount: number;
  weekLogCount: number;
  monthOvertimeCount: number;
};

export function CasesKpiBar({ kpis }: { kpis: CasesKpis }) {
  const pathname = usePathname();
  const sp = useSearchParams();

  // 全部用 <Link>:button + router.push 不會觸發 RouteProgress 光條,
  // 慢網路點了像沒反應會被連點
  const behindParams = new URLSearchParams(sp.toString());
  behindParams.set("filter", "behind");

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <KpiCardLink
        label="進行中案件"
        value={kpis.activeCount}
        icon={<TrendingUp className="size-4" />}
        href={`${pathname}?status=active`}
      />
      <KpiCardLink
        label="進度落後"
        value={kpis.behindCount}
        tone="danger"
        icon={<AlertTriangle className="size-4" />}
        href={`${pathname}?${behindParams.toString()}`}
        hint="比工期該有的進度落後 20 個百分點以上"
      />
      <KpiCardLink
        label="本週新日誌"
        value={kpis.weekLogCount}
        icon={<FileText className="size-4" />}
        href="/logs?period=week"
      />
      <KpiCardLink
        label="本月超工筆數"
        value={kpis.monthOvertimeCount}
        icon={<FileWarning className="size-4" />}
        href="/reports/unsigned?period=month"
        hint="點工 + 變更追加"
      />
    </div>
  );
}


function KpiCardLink({
  label,
  value,
  icon,
  href,
  hint,
  tone,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  href: string;
  hint?: string;
  tone?: "danger";
}) {
  const danger = tone === "danger" && value > 0;
  return (
    <Link
      href={href}
      className={`group flex flex-col items-start rounded-lg border px-4 py-3.5 transition-colors md:px-5 md:py-4 ${
        danger
          ? "border-[#FCA5A5] bg-[#FEF2F2] hover:border-[#B91C1C]"
          : "border-[#E0DCD6] bg-card hover:border-accent"
      }`}
    >
      <div
        className={`flex items-center gap-1.5 text-xs ${
          danger ? "text-[#B91C1C]" : "text-muted-foreground"
        }`}
      >
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums md:text-3xl ${
          danger ? "text-[#B91C1C]" : "text-primary"
        }`}
      >
        {value}
      </div>
      {hint && (
        <div
          className={`mt-1 text-[11px] ${
            danger ? "text-[#B91C1C]/70" : "text-muted-foreground"
          }`}
        >
          {hint}
        </div>
      )}
    </Link>
  );
}
