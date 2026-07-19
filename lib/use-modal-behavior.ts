"use client";

import { useEffect, type RefObject } from "react";

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

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// 巢狀 modal(確認框疊在 sheet 上)時只有最上層的 trap 生效,
// 不然外層 trap 會把焦點從內層搶回去。
const trapStack: HTMLElement[] = [];

/**
 * Focus trap:開啟時把焦點移進 modal、Tab / Shift+Tab 在 modal 內循環,
 * 關閉時焦點還給開啟前的元素(通常是觸發按鈕)。
 *
 * 初始焦點:若已有元素在 modal 內拿到焦點(例如欄位的 autoFocus、
 * caller 自己 focus 取消鈕)就尊重它,否則落在第一個可聚焦元素。
 */
export function useFocusTrap(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;

    trapStack.push(root);
    const prev = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0,
      );

    if (!root.contains(document.activeElement)) {
      (focusables()[0] ?? root).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (trapStack[trapStack.length - 1] !== root) return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      const outside = !root.contains(active);
      if (e.shiftKey) {
        if (outside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = trapStack.lastIndexOf(root);
      if (i >= 0) trapStack.splice(i, 1);
      prev?.focus?.();
    };
  }, [open, rootRef]);
}
