/**
 * loading.tsx 骨架的共用原語 — 顏色與 a11y 屬性集中在這裡,
 * 各頁骨架只組版面(尺寸 / 排列)。
 *
 * 為什麼需要骨架:App Router 沒有 loading boundary 時,點連結後畫面會
 * 停在原頁完全不動,慢網路 2-5 秒像當機。RouteProgress 的頂部光條只有
 * 3px,大頁面(全表撈的報表、多 query 的 dashboard)值得整頁視覺回饋。
 */

import { cn } from "@/lib/utils";

/** 骨架頁根容器:animate-pulse + role="status"(screen reader 唸「載入中」) */
export function SkeletonPage({
  className,
  children,
}: {
  /** 蓋掉預設 max-w-7xl 等 */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("mx-auto max-w-7xl animate-pulse", className)}
      aria-label="載入中"
      role="status"
    >
      {children}
    </div>
  );
}

// 三個灰階:標題最深 → 內文最淺(裕民米白色系,不用冷灰)
const BAR_TONE = {
  strong: "bg-[#E0DCD6]",
  mid: "bg-[#E0DCD6]/70",
  soft: "bg-[#F0EBE4]",
} as const;

/** 單條佔位 bar — 尺寸(h-* / w-*)由 caller 的 className 決定 */
export function SkeletonBar({
  tone = "strong",
  className,
}: {
  tone?: keyof typeof BAR_TONE;
  className?: string;
}) {
  return <div className={cn("rounded", BAR_TONE[tone], className)} />;
}

/** 卡片外框佔位 */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("rounded-lg border border-[#E0DCD6] bg-card p-4", className)}
    >
      {children}
    </div>
  );
}
