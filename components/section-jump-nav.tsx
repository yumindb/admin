"use client";

import { useEffect, useState } from "react";

/**
 * 長頁面的區塊快跳導覽列 — 案件詳情頁用。
 *
 * 為什麼:案件頁的工項樹動輒上千列,加上照片 / 出勤 / 大事記,
 * 想看「未簽約」得滑好幾屏。這條 sticky bar 讓每個區塊一鍵直達,
 * scrollspy 高亮目前所在區塊,滑到哪都知道自己在哪、要去哪。
 *
 * 用法:目標區塊掛相同的 id + `scroll-mt-16`(清出 sticky bar 的高度)。
 * count 為 0 的區塊照樣顯示(讓使用者知道「這案子沒有未簽約」也是資訊)。
 */

export type JumpSection = {
  id: string;
  label: string;
  count?: number;
};

export function SectionJumpNav({ sections }: { sections: JumpSection[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");

  // scrollspy:取「頂端已越過視窗上緣(含 bar 高度)」的最後一個區塊。
  // 用 scroll + rAF 而不是 IntersectionObserver — 區塊高度差異極大
  // (工項樹幾千 px、大事記幾百 px),threshold 式的 observer 很難調得準。
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const offset = 72; // sticky bar 高度 + 一點緩衝
        let current = sections[0]?.id ?? "";
        for (const s of sections) {
          const el = document.getElementById(s.id);
          if (!el) continue;
          if (el.getBoundingClientRect().top <= offset) current = s.id;
        }
        setActive(current);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections]);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav
      aria-label="頁面區塊"
      className="sticky top-0 z-20 -mx-4 mb-6 border-b border-[#E0DCD6] bg-[#F5F1EC]/95 px-4 backdrop-blur-sm md:-mx-8 md:px-8 lg:-mx-12 lg:px-12"
    >
      {/* 手機:橫向捲動不折行;桌機:一列排開 */}
      <div className="flex items-center gap-1.5 overflow-x-auto py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => {
          const isActive = active === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => jump(s.id)}
              aria-current={isActive ? "true" : undefined}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary text-white"
                  : "text-foreground hover:bg-white"
              }`}
            >
              {s.label}
              {s.count !== undefined && s.count > 0 && (
                <span
                  className={`text-xs tabular-nums ${
                    isActive ? "text-white/75" : "text-muted-foreground"
                  }`}
                >
                  {s.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
