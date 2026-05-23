"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

/**
 * 簽核 detail 用的可摺疊區塊。
 *
 * 老闆視角測試:整頁 detail 七大段全展開在手機上要捲半天,
 * 真實使用場景「2 分鐘決定簽或退」做不到。
 *
 * 處理:
 *  - SSR 預設 open(避免 hydration mismatch + 沒 JS 也能用)
 *  - mount 後 JS 偵測:手機 (< md, 768px) 預設摺疊,桌機保持展開
 *  - alwaysOpen=true 用在「簽核摘要」這種一定要看到的卡
 *  - 桌機簽核者(辦公室助理)看到的還是預設全展開行為
 */
export function SignSection({
  title,
  count,
  alert,
  alwaysOpen = false,
  children,
}: {
  title: string;
  /** 標題後括號內的數字,例如「(5)」。空時不顯示 */
  count?: number;
  /** 標題後的紅色警示 chip,例:「無照片」 */
  alert?: string;
  /** 強制保持展開(用於簽核摘要等關鍵卡) */
  alwaysOpen?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (alwaysOpen) {
      ref.current.open = true;
      return;
    }
    // mobile breakpoint (Tailwind md = 768px)
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    ref.current.open = !isMobile;
  }, [alwaysOpen]);

  return (
    <details
      ref={ref}
      open
      className="group mb-5 rounded-md border border-[#E0DCD6] bg-card md:mb-7 md:border-0 md:bg-transparent"
    >
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 px-4 py-3 md:px-0 md:py-0 md:mb-3 ${
          alwaysOpen ? "cursor-default" : ""
        }`}
      >
        <h2 className="flex-1 text-base font-semibold text-primary md:text-lg">
          {title}
          {typeof count === "number" && count > 0 && (
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              ({count})
            </span>
          )}
          {alert && (
            <span className="ml-2 rounded-full border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-0.5 text-xs text-[#B91C1C]">
              {alert}
            </span>
          )}
        </h2>
        {!alwaysOpen && (
          <ChevronDown
            className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 md:hidden"
            aria-hidden
          />
        )}
      </summary>
      <div className="border-t border-[#F0EBE4] px-4 pt-3 pb-4 md:border-0 md:px-0 md:py-0">
        {children}
      </div>
    </details>
  );
}
