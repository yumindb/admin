"use client";

import { useEffect } from "react";

/**
 * Modal/Dialog 開啟期間鎖定背景頁面捲動。
 *
 * 為什麼需要:手機上手指在 modal(尤其遮罩)上滑動時,捲動會鏈到 body,
 * 關掉 modal 後發現頁面位置跑掉 — 跟 2026-07 修掉的 lightbox 是同一類病。
 * 搭配 modal 內可捲區域的 `overscroll-contain` 使用(iOS 對 body
 * overflow hidden 的支援不完全,雙保險)。
 *
 * 巢狀 modal(確認框疊在 sheet 上)也安全:還原時寫回前一層存的值。
 */
export function useBodyScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}

/**
 * ESC 關閉 modal。`enabled=false` 可在 pending 中暫停(避免處理到一半關掉)。
 */
export function useEscToClose(
  open: boolean,
  onClose: () => void,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!open || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, enabled, onClose]);
}
