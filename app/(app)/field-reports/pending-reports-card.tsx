"use client";

/**
 * 離線回報待送卡片 — 掛在 /field-reports 列表頁。
 *
 * 為什麼需要:離線佇列原本只在「新增回報」表單頁會 flush,工人離線送出後
 * 看到「連上網路會自動送出」就關頁面,回報永遠躺在 IndexedDB —— 列表頁
 * 也看不到任何痕跡,會以為已經回報成功。這張卡片:
 *   1. 在列表頁 mount 時 + 恢復連線時自動補送,成功給 toast
 *   2. 顯示還在排隊的筆數與失敗原因
 *   3. 重試 5 次失敗的死信提供「移除」出口(server 驗證拒絕的永遠不會成功)
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  listPendingReports,
  removeReport,
  bumpReportAttempts,
  MAX_REPORT_ATTEMPTS,
  type PendingReport,
} from "@/lib/offline-report-queue";
import { createFieldReportAction } from "./actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function PendingReportsCard() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingReport[]>([]);
  const [flushing, setFlushing] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PendingReport | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPending(await listPendingReports());
    } catch {
      // IndexedDB 不可用(隱私模式)就整張卡不顯示
    }
  }, []);

  const flush = useCallback(async () => {
    if (flushing) return;
    setFlushing(true);
    try {
      const list = await listPendingReports();
      let sent = 0;
      for (const item of list) {
        if (item.attempts >= MAX_REPORT_ATTEMPTS) continue;
        try {
          const res = await createFieldReportAction({
            caseId: item.case_id,
            note: item.note,
            photos: item.photos,
            submitLocation:
              item.submit_lat !== null && item.submit_lng !== null
                ? {
                    lat: item.submit_lat,
                    lng: item.submit_lng,
                    accuracy_m: item.submit_accuracy_m,
                  }
                : null,
          });
          if (res.ok) {
            await removeReport(item.id);
            sent += 1;
          } else {
            await bumpReportAttempts(item.id, res.error ?? "未知錯誤");
          }
        } catch (e) {
          await bumpReportAttempts(item.id, (e as Error).message ?? "未知錯誤");
        }
      }
      await refresh();
      if (sent > 0) {
        toast.success(`已補送 ${sent} 筆離線回報`);
        router.refresh();
      }
    } finally {
      setFlushing(false);
    }
  }, [flushing, refresh, router]);

  useEffect(() => {
    void refresh();
    void flush();
    const handler = () => void flush();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pending.length === 0) return null;

  const failed = pending.filter((p) => p.attempts >= MAX_REPORT_ATTEMPTS);

  return (
    <div className="mb-4 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[#92400E]">
          {failed.length < pending.length
            ? `有 ${pending.length - failed.length} 筆離線回報排隊中 — 連上網路後回到本頁會自動補送`
            : "離線回報補送失敗"}
        </p>
        {flushing && (
          <span className="shrink-0 text-xs text-[#92400E]/70">補送中…</span>
        )}
      </div>
      {failed.length > 0 && (
        <ul className="mt-2 space-y-2">
          {failed.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-md border border-[#FCA5A5] bg-white px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate text-foreground">
                  {p.note ? p.note.slice(0, 40) : "（無文字，只有照片）"}
                </div>
                <div className="mt-0.5 text-xs text-[#B91C1C]">
                  已重試 {p.attempts} 次失敗
                  {p.last_error ? `：${p.last_error}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRemoveTarget(p)}
                className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-[#E0DCD6] bg-white px-3 text-sm text-[#B91C1C] hover:border-[#B91C1C]"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removeTarget !== null}
        title="移除這筆離線回報？"
        description={
          "這筆回報一直送不出去（通常是內容被系統拒絕），移除後就不會再嘗試補送。" +
          "如果內容重要，請重新填一筆回報。"
        }
        confirmText="移除"
        danger
        onConfirm={async () => {
          if (removeTarget) {
            await removeReport(removeTarget.id);
            await refresh();
            toast.success("已移除");
          }
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
