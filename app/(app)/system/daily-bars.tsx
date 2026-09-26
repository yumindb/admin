"use client";

import { useState } from "react";

/**
 * 監控頁的每日趨勢小長條圖(單一數列,不需要圖例 — 標題就說明畫的是什麼)。
 * 滑鼠移上去 / 鍵盤 Tab 到某一天會顯示當天數字;同樣的數字在圖下方的表格也看得到。
 * 顏色 #3a6ea5 過了 dataviz 驗證(品牌深藍 #003153 太暗、會讀成灰色,只用在 hover)。
 */

export type DailyBarDatum = {
  /** YYYY-MM-DD(台北日期) */
  day: string;
  value: number;
  /** tooltip 裡數字下方的補充說明,例:「頁面 120、操作 34」 */
  lines?: string[];
};

function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function DailyBars({
  data,
  unit,
  ariaLabel,
}: {
  data: DailyBarDatum[];
  unit: string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">這段期間還沒有資料</p>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;

  return (
    <div className="relative" aria-label={ariaLabel} role="group">
      <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground tabular-nums">
        <span>最高 {max.toLocaleString("zh-TW")} {unit}</span>
      </div>
      <div
        className="relative grid h-32 items-end border-b border-[#E0DCD6]"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, columnGap: "2px" }}
        onMouseLeave={() => setActive(null)}
      >
        {/* 頂端參考線(= 最高值) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-[#EFEBE6]" />
        {data.map((d, i) => {
          const pct = d.value > 0 ? Math.max(2, (d.value / max) * 100) : 0;
          const isActive = active === i;
          const align = i < n / 3 ? "left-0" : i >= (n * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2";
          return (
            <button
              key={d.day}
              type="button"
              className="relative flex h-full items-end justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#A07850]/60"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${d.day}：${d.value} ${unit}${d.lines?.length ? `（${d.lines.join("、")}）` : ""}`}
            >
              <span
                className="block w-full max-w-[24px] rounded-t-[4px] transition-colors"
                style={{
                  height: `${pct}%`,
                  backgroundColor: isActive ? "#003153" : "#3a6ea5",
                }}
              />
              {isActive && (
                <span
                  className={`pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-md border border-[#E0DCD6] bg-white px-3 py-2 text-left shadow-sm ${align}`}
                >
                  <span className="block text-base font-semibold text-foreground tabular-nums">
                    {d.value.toLocaleString("zh-TW")} {unit}
                  </span>
                  <span className="block text-xs text-muted-foreground">{d.day}</span>
                  {d.lines?.map((line) => (
                    <span key={line} className="block text-xs text-muted-foreground">
                      {line}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{shortDay(data[0].day)}</span>
        {n > 1 && <span>{shortDay(data[n - 1].day)}</span>}
      </div>
    </div>
  );
}
