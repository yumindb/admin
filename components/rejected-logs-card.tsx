import Link from "next/link";
import { formatDateTW } from "@/lib/datetime";
import type { MyRejectedLog } from "@/lib/logs/rejected";

/**
 * /logs 最上面的退件提示 — 只列「自己填的」被退回日誌,每份附原因與「去修改」。
 * 沒有退件就不出現。
 */
/** 直接攤開的份數;其餘收進「還有 N 份」,免得退件一多整個列表被推出手機畫面 */
const VISIBLE = 3;

export function RejectedLogsCard({
  logs,
  total,
  className,
}: {
  logs: MyRejectedLog[];
  /** 實際退件總數(logs 可能被截在上限) */
  total: number;
  className?: string;
}) {
  if (logs.length === 0) return null;
  const head = logs.slice(0, VISIBLE);
  const rest = logs.slice(VISIBLE);
  const hidden = total - head.length;
  return (
    <section
      aria-label="被退回的日誌"
      className={`rounded-md border-2 border-[#FCA5A5] bg-[#FEF2F2] p-4 ${className ?? ""}`}
    >
      <p className="text-base font-semibold text-[#B91C1C]">
        你有 {total} 份日誌被退回，要修改後重新送出
      </p>
      {total > 1 && (
        <p className="mt-0.5 text-xs text-[#7F1D1D]">最久的排最前面</p>
      )}
      <ul className="mt-3 space-y-2">
        {head.map((l) => (
          <RejectedRow key={l.id} log={l} />
        ))}
      </ul>
      {hidden > 0 && (
        <details className="group mt-2">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-center rounded-md border border-[#FECACA] bg-white text-sm font-medium text-[#B91C1C] [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">還有 {hidden} 份，點開看</span>
            <span className="hidden group-open:inline">收起來</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {rest.map((l) => (
              <RejectedRow key={l.id} log={l} />
            ))}
          </ul>
          {total > logs.length && (
            <p className="mt-2 text-xs text-[#7F1D1D]">
              這裡只列最久的 {logs.length} 份，改完送出後會補上其他的。
            </p>
          )}
        </details>
      )}
    </section>
  );
}

function RejectedRow({ log: l }: { log: MyRejectedLog }) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-[#FECACA] bg-white p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          <span className="break-words">{l.caseName}</span>
          <span className="ml-2 text-muted-foreground">
            {formatDateTW(l.logDate)}
          </span>
        </p>
        <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-[#7F1D1D]">
          原因：{l.reason ?? "沒有寫原因，點進去看簽核紀錄"}
        </p>
      </div>
      <Link
        href={`/logs/${l.id}/edit`}
        className="inline-flex h-11 shrink-0 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.98]"
      >
        去修改
      </Link>
    </li>
  );
}
