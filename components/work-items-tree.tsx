"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 階層樹狀工項顯示元件 — preview 與 case detail 共用。
 *
 * 功能：
 *   - 折疊／展開（預設：section 全展開、item 展開、spec 收起）
 *   - 列出 7 欄資訊（項次／項目／單位／數量／單價／複價／備註）
 *   - 可選 toggleable rows（preview 時勾「略過」）
 */

export type TreeItem = {
  id: string;
  parentId: string | null;
  depth: number;
  itemType: "section" | "item" | "spec" | "manual";
  tenderCode: string | null;
  name: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  brandNote: string | null;
  specText: string | null;
  skipped?: boolean;
  warningMsg?: string;
};

/**
 * 進度資料 — case detail 顯示「累計完成」用。
 * key = work_item_id,value = 跨所有日誌的累計完成量(absolute,unit 自然單位)。
 * 不傳就不顯示「進度」欄。
 */
export type ProgressMap = Map<string, number>;

type Props = {
  items: TreeItem[];                // 扁平陣列，但有 parentId
  defaultExpandSpecs?: boolean;     // 預設展開 spec 子項
  onToggleSkipped?: (id: string, next: boolean) => void;
  showSkippedToggle?: boolean;
  progress?: ProgressMap;
};

export function WorkItemsTree({
  items,
  defaultExpandSpecs = false,
  onToggleSkipped,
  showSkippedToggle = false,
  progress,
}: Props) {
  // 重建樹
  const { roots, byParent } = useMemo(() => {
    const byParent = new Map<string | null, TreeItem[]>();
    for (const it of items) {
      const arr = byParent.get(it.parentId) ?? [];
      arr.push(it);
      byParent.set(it.parentId, arr);
    }
    return { roots: byParent.get(null) ?? [], byParent };
  }, [items]);

  // 預設展開狀態：section / item 展開；spec 看 prop
  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.itemType === "section" || it.itemType === "item") set.add(it.id);
      else if (defaultExpandSpecs && it.itemType === "spec") set.add(it.id);
    }
    return set;
  }, [items, defaultExpandSpecs]);
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center text-base text-muted-foreground">
        尚無工項
      </div>
    );
  }

  const showProgress = !!progress;

  return (
    <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
      <table className="min-w-full text-base">
        <thead>
          <tr className="bg-primary text-primary-foreground">
            <Th className="w-[18%]">項次</Th>
            <Th className={showProgress ? "w-[32%]" : "w-[40%]"}>項目及說明</Th>
            <Th className="w-[6%]">單位</Th>
            <Th className="w-[8%] text-right">契約數量</Th>
            {showProgress && <Th className="w-[14%] text-right">累計完成</Th>}
            <Th className="w-[8%] text-right">單價</Th>
            <Th className="w-[8%] text-right">複價</Th>
            {showSkippedToggle ? (
              <Th className="w-[4%] text-center">略過</Th>
            ) : (
              <Th className="w-[4%]" />
            )}
          </tr>
        </thead>
        <tbody>
          {roots.map((r) => (
            <Row
              key={r.id}
              node={r}
              byParent={byParent}
              expanded={expanded}
              onToggle={toggle}
              onToggleSkipped={onToggleSkipped}
              showSkippedToggle={showSkippedToggle}
              progress={progress}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("h-12 px-3 text-left text-sm font-medium tracking-wider md:px-4", className)}>
      {children}
    </th>
  );
}

function Row({
  node,
  byParent,
  expanded,
  onToggle,
  onToggleSkipped,
  showSkippedToggle,
  progress,
}: {
  node: TreeItem;
  byParent: Map<string | null, TreeItem[]>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onToggleSkipped?: (id: string, next: boolean) => void;
  showSkippedToggle: boolean;
  progress?: ProgressMap;
}) {
  const children = byParent.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(node.id);

  const isSection = node.itemType === "section";
  const isSpec = node.itemType === "spec";

  return (
    <>
      <tr
        className={cn(
          "border-b border-[#E0DCD6] transition-colors hover:bg-[#F5F1EC]",
          node.skipped && "opacity-50",
          isSection && "bg-[#FAF7F2] font-medium"
        )}
      >
        <td className="h-14 px-3 align-top md:px-4">
          <div
            className="flex items-start gap-1"
            style={{ paddingLeft: `${node.depth * 14}px` }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => onToggle(node.id)}
                className="mt-0.5 inline-flex size-4 items-center justify-center text-muted-foreground hover:text-accent"
                aria-label={isOpen ? "收起" : "展開"}
              >
                {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
            ) : (
              <span className="inline-block size-4" />
            )}
            <span
              className={cn(
                "font-mono text-xs",
                isSection ? "text-primary" : "text-muted-foreground"
              )}
            >
              {node.tenderCode ?? (isSpec ? "—" : "")}
            </span>
          </div>
        </td>

        <td className="h-14 px-3 py-2 align-top md:px-4">
          <div
            className={cn(
              "whitespace-pre-line text-base",
              isSection && "text-primary font-medium",
              isSpec && "text-sm"
            )}
          >
            {node.name}
          </div>
          {node.brandNote && (
            <div className="mt-1 text-sm text-[#A07850]">廠牌：{node.brandNote}</div>
          )}
          {node.warningMsg && (
            <div className="mt-1 text-sm text-[#B91C1C]">⚠ {node.warningMsg}</div>
          )}
        </td>

        <td className="h-14 px-3 align-top md:px-4 text-muted-foreground">{node.unit ?? "—"}</td>
        <td className="h-14 px-3 align-top md:px-4 text-right tabular-nums">
          {node.quantity ?? "—"}
        </td>
        {progress && (
          <ProgressCell
            done={progress.get(node.id)}
            total={node.quantity ?? null}
            unit={node.unit ?? null}
            isSection={isSection}
          />
        )}
        <td className="h-14 px-3 align-top md:px-4 text-right tabular-nums">
          {node.unitPrice ?? "—"}
        </td>
        <td className="h-14 px-3 align-top md:px-4 text-right tabular-nums">
          {node.totalPrice ?? "—"}
        </td>
        <td className="h-14 px-3 align-top md:px-4 text-center">
          {showSkippedToggle && onToggleSkipped ? (
            <input
              type="checkbox"
              checked={!!node.skipped}
              onChange={(e) => onToggleSkipped(node.id, e.target.checked)}
              className="size-4 cursor-pointer accent-[#A07850]"
              aria-label={isSection ? "略過此分類及所有子項" : "略過此項"}
              title={isSection ? "略過此分類及所有子項" : "略過此項"}
            />
          ) : null}
        </td>
      </tr>

      {hasChildren && isOpen
        ? children.map((c) => (
            <Row
              key={c.id}
              node={c}
              byParent={byParent}
              expanded={expanded}
              onToggle={onToggle}
              onToggleSkipped={onToggleSkipped}
              showSkippedToggle={showSkippedToggle}
              progress={progress}
            />
          ))
        : null}
    </>
  );
}

function ProgressCell({
  done,
  total,
  unit,
  isSection,
}: {
  done: number | undefined;
  total: number | null;
  unit: string | null;
  isSection: boolean;
}) {
  if (isSection || !done || done <= 0) {
    return <td className="h-12 px-3 align-top text-right text-xs text-muted-foreground">—</td>;
  }
  const pct = total && total > 0 ? Math.round((done / total) * 100) : null;
  // 顏色:0% 灰、1-99% 琥珀、100% 松綠、>100% 銅金(超量)
  const color =
    pct === null
      ? "text-muted-foreground"
      : pct >= 100
      ? "text-[#4A7C59]"
      : pct >= 50
      ? "text-[#D97706]"
      : "text-[#A07850]";
  return (
    <td className="h-12 px-3 align-top text-right">
      <div className={cn("text-xs tabular-nums", color)}>
        {done.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        {unit ? ` ${unit}` : ""}
      </div>
      {pct !== null && (
        <div className={cn("text-[11px] tabular-nums", color)}>
          {pct}%
        </div>
      )}
    </td>
  );
}
