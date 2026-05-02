"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** 光條顯示後至少要停留多久才能消失。本機 dev 切頁常常 <100ms,
 *  沒有最短顯示時間人眼根本看不到。設 600ms 才足夠看到動畫真的有在動。 */
const MIN_VISIBLE_MS = 600;

/**
 * 全站頁面切換進度條 — 點 internal Link 後到下一頁 render 完之間,
 * 上方會出現一條滑動光條,讓使用者知道「按鈕有反應、系統在處理」。
 *
 * 偵測方式:
 *   1. 監聽 document click,內部連結 → 進入 active(顯示)
 *   2. usePathname 改變 = 新頁面 render 完 → 退出 active(隱藏)
 *   3. 安全網:8 秒沒結束就強制關掉,避免卡住
 *
 * 為什麼不用 nprogress / Next 內建 useLinkStatus:
 *   - nprogress 是新依賴,不想引入(需求單純)
 *   - useLinkStatus 是 per-Link hook,要包每個 Link 才能用,不適合全站
 */
export function RouteProgress() {
  const [active, setActive] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const pathname = usePathname();

  // 監聽點擊內部連結。
  // ⚠ 必須用 capture phase:Next.js <Link> 的 onClick 會 preventDefault 自己接管,
  //   bubble phase 跑到 document 時 e.defaultPrevented 已是 true → 永遠看不到 click。
  //   用 capture phase 在 Link handler 之前先攔截。
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // 修飾鍵點擊(開新分頁/視窗)、右鍵不算
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        e.button !== 0
      ) {
        return;
      }
      const target = e.target;
      if (!(target instanceof Element)) return;
      const a = target.closest("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (a.target && a.target !== "" && a.target !== "_self") return;
      try {
        const url = new URL(href, window.location.href);
        // 跨站 → 不管(瀏覽器自己會切走)
        if (url.origin !== window.location.origin) return;
        // 連到「同一頁面 + 同 query」 = 沒有真的 navigation
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search
        ) {
          return;
        }
      } catch {
        return;
      }
      startedAtRef.current = Date.now();
      setActive(true);
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  // pathname 改變 = navigation 結束。但本機切頁很快,加最短顯示時間。
  useEffect(() => {
    if (startedAtRef.current === null) {
      setActive(false);
      return;
    }
    const elapsed = Date.now() - startedAtRef.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const t = setTimeout(() => {
      setActive(false);
      startedAtRef.current = null;
    }, remaining);
    return () => clearTimeout(t);
  }, [pathname]);

  // 安全網
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(false), 8000);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-[#A07850]/10 transition-opacity duration-200 ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* 動畫用 inline style 避免被 Tailwind preflight / class 重排影響 */}
      <div
        className="h-full w-1/5 bg-accent"
        style={{ animation: "route-progress-slide 1.1s linear infinite" }}
      />
    </div>
  );
}
