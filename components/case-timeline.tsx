import Link from "next/link";
import { formatTW } from "@/lib/datetime";

/**
 * 案件大事記 — 把日誌簽核、追加合約、未簽約項、現場回報、標單匯入
 * 聚合成一條時間軸(案件詳情頁用)。純呈現元件,資料由 server component 組好傳入。
 */

export type CaseTimelineEvent = {
  id: string;
  /** ISO timestamp,用來排序與顯示 */
  at: string;
  /** 左側類別 badge 文字 */
  badge: string;
  /** 主文,例:「王主任 送出 05/12 的日誌」 */
  label: string;
  /** 次行補充(退回原因、合約名等) */
  detail?: string | null;
  href?: string | null;
  tone?: "default" | "success" | "danger" | "accent";
};

const TONE_CLASS: Record<NonNullable<CaseTimelineEvent["tone"]>, string> = {
  default: "bg-[#F5F1EC] text-[#5A5050]",
  success: "bg-emerald-50 text-emerald-700",
  danger: "bg-red-50 text-red-700",
  accent: "bg-[#F5F1EC] text-[#A07850]",
};

export function CaseTimeline({
  events,
  emptyText = "還沒有活動紀錄",
}: {
  events: CaseTimelineEvent[];
  emptyText?: string;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <ol className="rounded-lg border border-[#E0DCD6] bg-card">
      {events.map((e) => {
        const inner = (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
            <span className="w-[6.5rem] shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {formatTW(e.at, {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${TONE_CLASS[e.tone ?? "default"]}`}
            >
              {e.badge}
            </span>
            <span className="min-w-0 flex-1 text-sm text-foreground">
              {e.label}
              {e.detail && (
                <span className="ml-2 text-muted-foreground">{e.detail}</span>
              )}
            </span>
          </div>
        );
        return (
          <li
            key={e.id}
            className="border-b border-[#E0DCD6]/60 last:border-0"
          >
            {e.href ? (
              <Link
                href={e.href}
                className="block transition-colors hover:bg-[#F5F1EC]/50"
              >
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ol>
  );
}
