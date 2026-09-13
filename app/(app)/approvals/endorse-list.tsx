import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { NextStepHint } from "@/components/next-step-hint";
import { formatDateTW } from "@/lib/datetime";
import { formatWeatherSummary } from "@/lib/daily-log";
import type { DailyLog } from "@/lib/types";

type LogRow = DailyLog & {
  cases: { name: string; code: string | null } | null;
  profiles: { full_name: string } | null;
};

/**
 * 審閱人的「加簽」清單(2026-09-13)。
 *
 * 加簽跟流程無關:列的是「辦公室審核已通過、這一輪我還沒加簽」的日誌,
 * 簽不簽隨意 — 所以沒有紅色待辦數字、沒有批簽、沒有退回。
 * 點進去是跟簽核頁同一個畫面(摘要 / 工項 / 照片),底下只有簽名 + 意見。
 */
export function EndorseList({ logs }: { logs: LogRow[] }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">加簽</h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          辦公室審核通過的日誌，想簽就簽。這裡列的是這一輪你還沒簽過的，最近 100 份。
        </p>
      </div>

      <div className="mb-6">
        <NextStepHint tone="muted">
          加簽跟簽核流程無關 —— 不擋核定，簽不簽都可以。簽名與意見只留在系統裡
          （簽核歷程、我簽過的），不會印在 PDF 上。有寫意見會發消息給主任。
        </NextStepHint>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
          <CheckCircle2
            className="mb-3 size-14 text-[#E0DCD6]"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="text-base text-foreground">沒有可加簽的日誌</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            辦公室助理審核通過後會出現在這裡
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {logs.map((l) => (
            <li key={l.id}>
              <Link
                href={`/approvals/${l.id}`}
                className="block rounded-lg border border-[#E0DCD6] bg-card p-4 transition-colors hover:border-accent md:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-muted-foreground">
                      {l.cases?.code ?? "未編號"}
                    </div>
                    <h2 className="text-lg font-semibold text-primary md:text-xl">
                      {l.cases?.name ?? "（已刪除案件）"}
                    </h2>
                  </div>
                  <div className="shrink-0 text-right text-sm text-muted-foreground">
                    <div>{formatDateTW(l.log_date)}</div>
                    <div>{l.profiles?.full_name ?? "未知主任"}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span
                    className={
                      l.status === "approved"
                        ? "rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-xs text-[#4A7C59]"
                        : "rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-xs text-[#92400E]"
                    }
                  >
                    {l.status === "approved" ? "已核定" : "核定中"}
                  </span>
                  <span>{l.work_items?.length ?? 0} 個工項</span>
                  <span>{l.photos?.length ?? 0} 張照片</span>
                  {l.weather && <span>{formatWeatherSummary(l.weather)}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
