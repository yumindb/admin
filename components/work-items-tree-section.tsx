"use client";

/**
 * 工項清單(case detail 頁) — 包 WorkItemsTree 加上搜尋、篩選 pills、展開/收合按鈕。
 *
 * filter pills 是「多選 toggle」:
 *   - 全部:點下去清空其他選項
 *   - 已勾(已有日誌進度):done > 0
 *   - 100%+:超量(累計 / 契約 > 1)
 * 「未勾」不在這裡(那是日誌新建表單情境,picker 用)。
 */

import { useMemo, useState } from "react";
import { Search, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import {
  WorkItemsTree,
  type ProgressMap,
  type TreeFilterMode,
  type TreeItem,
} from "@/components/work-items-tree";

const PILLS: { key: TreeFilterMode; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "completed", label: "有進度" },
  { key: "over100", label: "100%+" },
];

export function WorkItemsTreeSection({
  items,
  progress,
}: {
  items: TreeItem[];
  progress: ProgressMap;
}) {
  const [query, setQuery] = useState("");
  const [modes, setModes] = useState<Set<TreeFilterMode>>(
    () => new Set<TreeFilterMode>(["all"]),
  );
  const [expandSignal, setExpandSignal] = useState(0);
  const [collapseSignal, setCollapseSignal] = useState(0);

  function togglePill(k: TreeFilterMode) {
    setModes((prev) => {
      const n = new Set(prev);
      if (k === "all") {
        return new Set<TreeFilterMode>(["all"]);
      }
      n.delete("all");
      if (n.has(k)) n.delete(k);
      else n.add(k);
      if (n.size === 0) n.add("all");
      return n;
    });
  }

  // 工項總數(僅 leaf — item / spec / manual)
  const leafCount = useMemo(
    () => items.filter((x) => x.itemType !== "section").length,
    [items],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`搜尋 ${leafCount} 個工項`}
            className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white pl-9 pr-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PILLS.map((p) => {
            const active = modes.has(p.key);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => togglePill(p.key)}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpandSignal((n) => n + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            title="展開全部"
          >
            <ChevronsUpDown className="size-3.5" /> 展開
          </button>
          <button
            type="button"
            onClick={() => setCollapseSignal((n) => n + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            title="收合全部"
          >
            <ChevronsDownUp className="size-3.5" /> 收合
          </button>
        </div>
      </div>

      <WorkItemsTree
        items={items}
        progress={progress}
        query={query}
        filterModes={modes}
        expandAllSignal={expandSignal || undefined}
        collapseAllSignal={collapseSignal || undefined}
      />
    </div>
  );
}
