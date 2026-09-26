"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarOff, ChevronLeft, ChevronRight } from "lucide-react";
import { toggleDayOffAction } from "@/app/(app)/attendance/day-off-actions";
import { dayOffBlockedReason, type DayOffRules } from "@/lib/payroll/settings";
import { isoWeekday } from "@/lib/payroll/holidays";
import { addDays } from "@/lib/payroll/schedule";

/**
 * 排休迷你月曆(手機優先)。點日期就標 / 取消,不用送出、不用簽核。
 * 只能標:未來、還沒排班、沒過截止日的日子;每月上限由 server 擋。
 */
export function DayOffCard({
  today,
  offDates,
  scheduledDates,
  rules,
}: {
  today: string;
  offDates: string[];
  scheduledDates: string[];
  rules: DayOffRules;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const off = new Set(offDates);
  const scheduled = new Set(scheduledDates);

  const [y, m] = month.split("-").map(Number);
  const firstDay = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const leading = isoWeekday(firstDay) - 1; // 週一起
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDays(firstDay, i)),
  ];
  const monthCount = offDates.filter((d) => d.startsWith(month)).length;
  const nextMonth = addDays(`${month}-01`, 32).slice(0, 7);
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7);
  const canGoPrev = prevMonth >= today.slice(0, 7);
  const canGoNext = nextMonth <= addDays(today, 62).slice(0, 7);

  function toggle(date: string) {
    const turningOn = !off.has(date);
    if (turningOn) {
      if (scheduled.has(date)) {
        toast.error("這天已經排班了,要休的話請走請假");
        return;
      }
      const blocked = dayOffBlockedReason(date, today, rules);
      if (blocked) {
        toast.error(blocked);
        return;
      }
    }
    setPendingDate(date);
    startTransition(async () => {
      const res = await toggleDayOffAction({ date, on: turningOn });
      setPendingDate(null);
      if (res.ok) {
        toast.success(turningOn ? `已標 ${Number(date.slice(5, 7))}/${Number(date.slice(8))} 排休` : "已取消排休");
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <section className="mt-6 rounded-md border border-[#E0DCD6] bg-card">
      <div className="flex items-center gap-2 border-b border-[#F0EBE4] px-4 py-3">
        <CalendarOff className="size-4 text-primary" strokeWidth={1.75} />
        <h2 className="text-base font-semibold text-primary">排休</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {m} 月已標 {monthCount} 天{rules.monthly_cap > 0 ? `／上限 ${rules.monthly_cap}` : ""}
        </span>
      </div>
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonth(prevMonth)}
            disabled={!canGoPrev}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F1EC] disabled:opacity-30"
            aria-label="上個月"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-medium text-foreground">{y} 年 {m} 月</span>
          <button
            type="button"
            onClick={() => setMonth(nextMonth)}
            disabled={!canGoNext}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-[#F5F1EC] disabled:opacity-30"
            aria-label="下個月"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
          {["一", "二", "三", "四", "五", "六", "日"].map((w) => (
            <div key={w} className="py-1">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} />;
            const isOff = off.has(d);
            const isSched = scheduled.has(d);
            const past = d < today;
            const blocked = !isOff && (past || isSched || !!dayOffBlockedReason(d, today, rules));
            const busy = pendingDate === d && isPending;
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggle(d)}
                disabled={blocked || busy}
                title={isSched ? "已排班" : isOff ? "點一下取消排休" : undefined}
                className={`relative flex min-h-11 flex-col items-center justify-center rounded-md border text-sm transition-colors ${
                  isOff
                    ? "border-accent bg-[#F5F1EC] font-semibold text-accent"
                    : blocked
                      ? "border-transparent text-muted-foreground/40"
                      : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                } ${d === today ? "ring-1 ring-primary/40" : ""}`}
              >
                <span>{Number(d.slice(8))}</span>
                {isOff && <span className="text-[10px] leading-none">休</span>}
                {isSched && !isOff && <span className="text-[10px] leading-none text-primary/70">班</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          點日期標「這天不能上」,排班的人會看到。已排好班的日子(標「班」)要休請走請假。
          {rules.deadline_day > 0 ? `下個月的排休請在每月 ${rules.deadline_day} 號前標完。` : ""}
        </p>
      </div>
    </section>
  );
}
