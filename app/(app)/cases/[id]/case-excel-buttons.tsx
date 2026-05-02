"use client";

/**
 * 案件 detail 頁的兩個 Excel 下載按鈕(client side wrapper)。
 *
 * - WorkItemsXlsxButton:工程進度表(三角色都可)
 * - MonthlyReportXlsxButton:月報(限 office_staff / owner;父層決定要不要 render)
 *
 * 月報按鈕同時提供「年月」picker(預設當月,可上下個月切換),
 * 點下後拼出參數呼叫 server action。
 */
import { useState } from "react";
import { ExcelDownloadButton } from "@/components/excel-download-button";
import {
  getCaseWorkItemsXlsxAction,
  getCaseMonthlyReportXlsxAction,
} from "./excel-actions";

export function WorkItemsXlsxButton({ caseId }: { caseId: string }) {
  return (
    <ExcelDownloadButton
      label="下載 Excel"
      size="lg"
      variant="outline"
      onFetch={() => getCaseWorkItemsXlsxAction(caseId)}
    />
  );
}

function getCurrentYearMonth(): { year: number; month: number } {
  // Asia/Taipei
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.format(new Date()); // 2026-05
  const [y, m] = parts.split("-").map((s) => parseInt(s, 10));
  return { year: y, month: m };
}

export function MonthlyReportXlsxButton({ caseId }: { caseId: string }) {
  const init = getCurrentYearMonth();
  const [year, setYear] = useState(init.year);
  const [month, setMonth] = useState(init.month);

  const monthInputValue = `${year}-${String(month).padStart(2, "0")}`;

  function onMonthChange(v: string) {
    // v 形如 "2026-05"
    const [ys, ms] = v.split("-");
    const y = parseInt(ys, 10);
    const m = parseInt(ms, 10);
    if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
      setYear(y);
      setMonth(m);
    }
  }

  return (
    <div className="inline-flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-xs text-muted-foreground">
        <span className="mb-1">月份</span>
        <input
          type="month"
          value={monthInputValue}
          onChange={(e) => onMonthChange(e.target.value)}
          className="h-11 rounded-md border border-[#E0DCD6] bg-card px-3 text-sm tabular-nums focus:border-accent focus:outline-none"
        />
      </label>
      <ExcelDownloadButton
        label="月報下載"
        size="lg"
        variant="outline"
        onFetch={() => getCaseMonthlyReportXlsxAction(caseId, year, month)}
      />
    </div>
  );
}
