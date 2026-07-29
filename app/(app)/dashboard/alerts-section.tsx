"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  dismissDashboardAlertAction,
  restoreDashboardAlertsAction,
} from "./actions";
import { DISMISS_DAYS } from "@/lib/dashboard-dismiss";

export type AlertItem = {
  kind: "rejected" | "stale";
  /** 被忽略時記的對象:rejected = 日誌 id、stale = 案件 id */
  targetId: string;
  title: string;
  detail: string;
  href: string;
};

const VISIBLE_LIMIT = 10;

/**
 * 「需要您出手」清單 + 每項各自的「先不理」。
 *
 * 忽略是 per-user 且會在 N 天後自動再出現(見 actions.ts 說明):
 * 這些警示代表真的有東西卡住,永久隱藏等於把問題藏起來。
 */
export function AlertsSection({
  alerts,
  dismissedCount,
}: {
  alerts: AlertItem[];
  dismissedCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // 樂觀移除:按下去就從畫面消失,不等 server round-trip
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const visible = alerts.filter((a) => !hidden.has(`${a.kind}:${a.targetId}`));

  function dismiss(a: AlertItem) {
    const key = `${a.kind}:${a.targetId}`;
    setHidden((prev) => new Set(prev).add(key));
    startTransition(async () => {
      const res = await dismissDashboardAlertAction({
        kind: a.kind,
        targetId: a.targetId,
      });
      if (!res.ok) {
        // 失敗就放回來,不要讓使用者以為收起來了其實沒有
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        toast.error(res.error);
        return;
      }
      toast.success(`先不理了，${DISMISS_DAYS} 天後會再提醒`);
      router.refresh();
    });
  }

  function restoreAll() {
    startTransition(async () => {
      const res = await restoreDashboardAlertsAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setHidden(new Set());
      toast.success("已復原忽略的提醒");
      router.refresh();
    });
  }

  if (visible.length === 0) {
    // 全部處理完 / 全部忽略 — 只在有忽略時留一行回復入口
    return dismissedCount > 0 ? (
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-[#E0DCD6] bg-card px-4 py-3 text-sm text-muted-foreground">
        <span>
          目前沒有要出手的事（有 {dismissedCount} 件先不理中，{DISMISS_DAYS} 天後會再提醒）
        </span>
        <button
          type="button"
          onClick={restoreAll}
          disabled={isPending}
          className="inline-flex min-h-9 items-center rounded-md px-2 text-accent underline underline-offset-2 hover:text-primary disabled:opacity-50"
        >
          立即復原
        </button>
      </div>
    ) : null;
  }

  return (
    <section className="mb-5 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span aria-hidden className="inline-block size-2.5 rounded-full bg-[#B91C1C]" />
        <h2 className="text-base font-semibold text-[#B91C1C]">
          需要您出手（{visible.length}）
        </h2>
        {dismissedCount > 0 && (
          <button
            type="button"
            onClick={restoreAll}
            disabled={isPending}
            className="ml-auto inline-flex min-h-9 items-center rounded-md px-2 text-xs text-[#92400E] underline underline-offset-2 hover:text-[#B91C1C] disabled:opacity-50"
          >
            另有 {dismissedCount} 件先不理中 · 復原
          </button>
        )}
      </div>
      <ul className="divide-y divide-[#FCA5A5]/40">
        {visible.slice(0, VISIBLE_LIMIT).map((a) => (
          <li key={`${a.kind}:${a.targetId}`} className="flex items-center gap-2">
            <Link
              href={a.href}
              className="-mx-2 block min-w-0 flex-1 rounded px-2 py-2 transition-colors hover:bg-[#FEE2E2]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-foreground">
                  {a.title}
                </span>
                <span className="shrink-0 text-xs text-[#B91C1C]">
                  {a.kind === "rejected" ? "退回未重送" : "案件停滯"}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {a.detail}
              </div>
            </Link>
            <button
              type="button"
              onClick={() => dismiss(a)}
              disabled={isPending}
              title={`先收起來，${DISMISS_DAYS} 天後再提醒`}
              className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-[#FCA5A5] bg-white px-3 text-xs text-[#B91C1C] transition-colors hover:bg-[#FEE2E2] disabled:opacity-50"
            >
              先不理
            </button>
          </li>
        ))}
        {visible.length > VISIBLE_LIMIT && (
          <li className="pt-2 text-xs text-muted-foreground">
            …共 {visible.length} 件，僅顯示前 {VISIBLE_LIMIT}
          </li>
        )}
      </ul>
    </section>
  );
}
