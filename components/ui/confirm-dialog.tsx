"use client";

/**
 * 共用站內確認對話框 — 取代 window.confirm()。
 *
 * 為什麼不用原生 confirm:
 *   - 桌機 Chrome 的 native dialog 醜、文字框小、樣式跟系統不一致
 *   - 沒辦法呈現「會影響的歷史日誌 / 工項清單」這種額外細節
 *   - 行動裝置的 UX 不一致
 *
 * 用法:
 *   <ConfirmDialog
 *     open={!!target}
 *     title="拆解追加合約「OO 合約」?"
 *     description="3 筆工項會退回「未簽約」區,合約本身會刪除。歷史日誌進度保留。"
 *     details={[{ label: "影響工項", value: "3 筆" }, { label: "歷史日誌", value: "12 筆(進度保留)" }]}
 *     confirmText="確認拆解"
 *     danger
 *     onConfirm={() => doIt()}
 *     onCancel={() => setTarget(null)}
 *   />
 */

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";

export type ConfirmDetail = { label: string; value: string };

export function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmText = "確認",
  cancelText = "取消",
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** 影響範圍/細節 — 顯示在 description 下方的 label/value 清單 */
  details?: ConfirmDetail[];
  confirmText?: string;
  cancelText?: string;
  /** 紅色 destructive 樣式 — 用於刪除 / 拆解等不可逆動作 */
  danger?: boolean;
  /** server action 進行中 — 鎖住兩顆按鈕避免重按 */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 開啟時把 focus 移到「取消」(危險操作不該預選確認)— ModalShell 的
  // focus trap 會尊重這裡先落好的焦點
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      pending={pending}
      ariaLabelledby="confirm-dialog-title"
      panelClassName="max-w-md"
    >
      <div className="border-b border-[#E0DCD6] px-5 py-3">
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-primary">
          {title}
        </h2>
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-5 py-4 text-sm leading-relaxed text-foreground">
        {description && (
          <p className="whitespace-pre-line">{description}</p>
        )}
        {details && details.length > 0 && (
          <ul className="rounded-md border border-[#E0DCD6] bg-[#FAF7F2]/60 divide-y divide-[#E0DCD6]">
            {details.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="text-xs text-muted-foreground">{d.label}</span>
                <span className="break-words text-right font-medium tabular-nums">
                  {d.value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-[#E0DCD6] px-5 py-3">
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending}
          className="border-[#E0DCD6]"
        >
          {cancelText}
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={
            danger
              ? "bg-[#B91C1C] text-white hover:bg-[#991B1B]"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }
        >
          {pending ? "處理中…" : confirmText}
        </Button>
      </div>
    </ModalShell>
  );
}
