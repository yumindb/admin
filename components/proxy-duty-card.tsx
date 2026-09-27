import Link from "next/link";
import { NextStepHint } from "@/components/next-step-hint";
import {
  formatDateWindow,
  formatShortDate,
  proxyGraceEnd,
  type ProxyDelegation,
} from "@/lib/leave-proxy";

/**
 * 現場人員的「請假代理」卡(migration-2.43)— 打卡、回報、日誌頁最上面。
 *
 * 現場人員平常沒有日誌入口;被主任指定為代理人那幾天,這張卡就是入口:
 * 進行中(含請假結束後的補寫寬限)→ 大按鈕「寫施工日誌」;
 * 一週內要開始的 → 先提醒一聲,不給按鈕(還不能寫)。
 */
export function ProxyDutyCard({
  active,
  upcoming,
  today,
  showLogsLink = true,
  className,
}: {
  active: ProxyDelegation[];
  upcoming: ProxyDelegation[];
  /** 台北今天 YYYY-MM-DD */
  today: string;
  /** 已經在 /logs 就不用再放「我寫的代理日誌」 */
  showLogsLink?: boolean;
  className?: string;
}) {
  if (active.length === 0 && upcoming.length === 0) return null;
  return (
    <section aria-label="請假代理" className={`space-y-2 ${className ?? ""}`}>
      {active.map((d) => {
        const ended = today > d.endDate;
        return (
          <div
            key={d.leaveId}
            className="rounded-md border-2 border-primary bg-[#EEF2F6] p-4"
          >
            <p className="text-base font-semibold text-primary">
              你是 {d.supervisorName} 的請假代理人
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">
              {ended
                ? `${d.supervisorName} 的請假（${formatDateWindow(d)}）已經結束，那幾天還沒送的施工日誌，${formatShortDate(proxyGraceEnd(d))} 前還可以補寫。`
                : `請假期間（${formatDateWindow(d)}）工地的施工日誌麻煩你代寫、簽名送出，一樣會送辦公室審核。`}
              {d.status === "pending" && !ended && " 假單還在簽核中，一樣可以先寫。"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/logs/new?leave=${d.leaveId}`}
                className="inline-flex h-12 items-center rounded-md bg-primary px-5 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.98]"
              >
                寫施工日誌
              </Link>
              {showLogsLink && (
                <Link
                  href="/logs"
                  className="inline-flex h-12 items-center rounded-md border border-[#E0DCD6] bg-white px-4 text-sm text-foreground transition-colors hover:border-accent"
                >
                  我寫過的代理日誌
                </Link>
              )}
            </div>
          </div>
        );
      })}
      {upcoming.map((d) => (
        <NextStepHint
          key={d.leaveId}
          tone="info"
          title={`${formatDateWindow(d)} 要代理 ${d.supervisorName}`}
        >
          {d.supervisorName} 那幾天請假，指定你當代理人。到時候這裡會出現「寫施工日誌」按鈕，
          工地的施工日誌麻煩你代寫送出。
        </NextStepHint>
      ))}
    </section>
  );
}
