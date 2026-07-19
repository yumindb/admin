"use client";

/**
 * 自製 modal 的共用外殼 — 收斂 12 個各自組裝的 modal 行為:
 *   - 鎖背景捲動 + ESC 關閉(pending 中不關)+ focus trap(lib/use-modal-behavior)
 *   - role="dialog" / aria-modal
 *   - 點背景關閉(可用 dismissOnBackdrop={false} 關掉 — 表單類 modal
 *     欄位多、誤觸丟失成本高的請關)
 *   - 統一 max-h-[85dvh] + 外框樣式;個別差異走 panelClassName / overlayClassName
 *     (cn 用 tailwind-merge,後傳的 class 會正確蓋掉基底)
 *
 * variant:
 *   - "center":手機桌機都置中(確認框、小型 dialog)
 *   - "sheet" :手機貼底 bottom sheet(圓上角)、桌機置中 — 鍵盤彈出時
 *              內容區可捲、動作鈕不會被鍵盤蓋住
 *
 * 內部佈局:外殼是 flex-col,caller 自己組 header / 可捲內容
 * (`min-h-0 overflow-y-auto overscroll-contain`)/ footer;整片可捲的
 * modal 也可以直接在 panelClassName 加 overflow-y-auto。
 */

import { useRef } from "react";
import { cn } from "@/lib/utils";
import {
  useBodyScrollLock,
  useEscToClose,
  useFocusTrap,
} from "@/lib/use-modal-behavior";

export function ModalShell({
  open = true,
  onClose,
  variant = "center",
  pending = false,
  dismissOnBackdrop = true,
  ariaLabel,
  ariaLabelledby,
  overlayClassName,
  panelClassName,
  children,
}: {
  /** 條件渲染(`{show && <ModalShell …>}`)的 caller 可不傳 */
  open?: boolean;
  onClose: () => void;
  variant?: "center" | "sheet";
  /** server action 進行中 — 暫停 ESC 與點背景關閉,避免處理到一半關掉 */
  pending?: boolean;
  dismissOnBackdrop?: boolean;
  ariaLabel?: string;
  ariaLabelledby?: string;
  /** 遮罩層 override(z-index、遮罩深淺) */
  overlayClassName?: string;
  /** 內容框 override(max-w 必傳;特殊高度、圓角、底色等) */
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);
  useEscToClose(open, onClose, !pending);
  useFocusTrap(open, panelRef);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      className={cn(
        "fixed inset-0 z-50 flex justify-center bg-black/40",
        variant === "sheet"
          ? "items-end md:items-center md:p-4"
          : "items-center p-4",
        overlayClassName,
      )}
      onClick={
        dismissOnBackdrop && !pending
          ? (e) => {
              if (e.target === e.currentTarget) onClose();
            }
          : undefined
      }
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "flex max-h-[85dvh] w-full flex-col border border-[#E0DCD6] bg-card shadow-lg outline-none",
          variant === "sheet" ? "rounded-t-2xl md:rounded-lg" : "rounded-lg",
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
