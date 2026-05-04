"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2, Plus } from "lucide-react";
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

/**
 * 篩選模式 — case detail 頁工項樹的多選 filter pills 用。
 *   - all:全部顯示(預設)
 *   - completed:有任何累計完成量(progress > 0)
 *   - over100:累計完成超過 100%(超量,需要警示)
 * 「未勾」(unselected)是日誌新建表單情境(picker),這裡不支援。
 */
export type TreeFilterMode = "all" | "completed" | "over100";

type Props = {
  items: TreeItem[];                // 扁平陣列，但有 parentId
  defaultExpandSpecs?: boolean;     // 預設展開 spec 子項
  onToggleSkipped?: (id: string, next: boolean) => void;
  showSkippedToggle?: boolean;
  progress?: ProgressMap;
  /** 文字搜尋(包含 tender_code / name / unit;不分大小寫) */
  query?: string;
  /** 篩選模式集合;空 set 或包含 "all" 等同不篩 */
  filterModes?: Set<TreeFilterMode>;
  /** 強制展開/收合所有節點 — 由父層按鈕控制(undefined 維持現狀) */
  expandAllSignal?: number;
  collapseAllSignal?: number;
  /** 是否顯示編輯 / 刪除 / 加子項 操作 (office_staff / owner) */
  editable?: boolean;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** 從某個 section 旁加子項;parentId 可為 null (root) */
  onAdd?: (parentId: string | null) => void;
};

export function WorkItemsTree({
  items,
  defaultExpandSpecs = false,
  onToggleSkipped,
  showSkippedToggle = false,
  progress,
  query,
  filterModes,
  expandAllSignal,
  collapseAllSignal,
  editable = false,
  onEdit,
  onDelete,
  onAdd,
}: Props) {
  // 重建樹
  const { roots, byParent, byId } = useMemo(() => {
    const byParent = new Map<string | null, TreeItem[]>();
    const byId = new Map<string, TreeItem>();
    for (const it of items) {
      const arr = byParent.get(it.parentId) ?? [];
      arr.push(it);
      byParent.set(it.parentId, arr);
      byId.set(it.id, it);
    }
    return { roots: byParent.get(null) ?? [], byParent, byId };
  }, [items]);

  // visibleIds:套用 query + filterModes 後仍要顯示的 node id 集合(包含 ancestor 鏈)
  // 沒有 filter 時為 null,代表全部顯示
  const visibleIds = useMemo<Set<string> | null>(() => {
    const q = (query ?? "").trim().toLowerCase();
    const modes = filterModes && filterModes.size > 0 ? filterModes : null;
    const hasQuery = q.length > 0;
    const hasModes = !!modes && !modes.has("all");
    if (!hasQuery && !hasModes) return null;

    const visible = new Set<string>();

    function addAncestors(id: string) {
      let cur = byId.get(id);
      while (cur?.parentId) {
        visible.add(cur.parentId);
        cur = byId.get(cur.parentId);
      }
    }
    function addDescendants(id: string) {
      const kids = byParent.get(id) ?? [];
      for (const k of kids) {
        visible.add(k.id);
        addDescendants(k.id);
      }
    }

    for (const item of items) {
      // section 不單獨匹配,只透過 ancestor 鏈帶入(避免整節展開造成沒意義的 hit)
      if (item.itemType === "section") continue;

      if (hasQuery) {
        const haystack = `${item.tenderCode ?? ""} ${item.name} ${item.unit ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      if (hasModes && modes) {
        const done = progress?.get(item.id) ?? 0;
        const total = item.quantity ?? 0;
        const pct = total > 0 ? done / total : done > 0 ? 1 : 0;
        const checks: boolean[] = [];
        if (modes.has("completed")) checks.push(done > 0);
        if (modes.has("over100")) checks.push(pct > 1);
        if (checks.length > 0 && !checks.some(Boolean)) continue;
      }

      visible.add(item.id);
      addAncestors(item.id);
      // descendants 不自動加(避免「進度」filter 帶出根本沒進度的子節點),
      // 但 spec 子節點通常是工項說明的延伸 → 也跟著顯示比較合理
      if (item.itemType !== "spec") addDescendants(item.id);
    }
    return visible;
  }, [byId, byParent, items, query, filterModes, progress]);

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

  // 父層觸發「展開全部」/「收合全部」— 透過 signal 計數變化辨識
  useEffect(() => {
    if (expandAllSignal === undefined) return;
    setExpanded(new Set(items.map((x) => x.id)));
  }, [expandAllSignal, items]);
  useEffect(() => {
    if (collapseAllSignal === undefined) return;
    // 收合到只剩 root section 仍可見;乾脆 set 為空,使用者要看時自己點
    setExpanded(new Set());
  }, [collapseAllSignal]);

  // 篩選有結果時自動展開命中節點的 ancestors,讓使用者直接看到符合的列
  useEffect(() => {
    if (!visibleIds) return;
    setExpanded((prev) => {
      const n = new Set(prev);
      for (const id of visibleIds) n.add(id);
      return n;
    });
  }, [visibleIds]);

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center text-base text-muted-foreground">
        尚無工項
      </div>
    );
  }

  const showProgress = !!progress;
  const visibleRoots = visibleIds
    ? roots.filter((r) => visibleIds.has(r.id))
    : roots;

  if (visibleIds && visibleRoots.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        沒有符合的工項
      </div>
    );
  }

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
          {visibleRoots.map((r) => (
            <Row
              key={r.id}
              node={r}
              byParent={byParent}
              expanded={expanded}
              onToggle={toggle}
              onToggleSkipped={onToggleSkipped}
              showSkippedToggle={showSkippedToggle}
              progress={progress}
              visibleIds={visibleIds}
              editable={editable}
              onEdit={onEdit}
              onDelete={onDelete}
              onAdd={onAdd}
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
  visibleIds,
  editable,
  onEdit,
  onDelete,
  onAdd,
}: {
  node: TreeItem;
  byParent: Map<string | null, TreeItem[]>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onToggleSkipped?: (id: string, next: boolean) => void;
  showSkippedToggle: boolean;
  progress?: ProgressMap;
  visibleIds: Set<string> | null;
  editable?: boolean;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onAdd?: (parentId: string | null) => void;
}) {
  const allChildren = byParent.get(node.id) ?? [];
  const children = visibleIds
    ? allChildren.filter((c) => visibleIds.has(c.id))
    : allChildren;
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(node.id);

  const isSection = node.itemType === "section";
  const isSpec = node.itemType === "spec";

  // section 不允許編輯;但 section 可以「在底下加子項」
  const showEdit = editable && !!onEdit && !isSection;
  const showDelete = editable && !!onDelete;
  const showAdd = editable && !!onAdd && isSection;

  return (
    <>
      <tr
        className={cn(
          "group border-b border-[#E0DCD6] transition-colors hover:bg-[#F5F1EC]",
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
            {node.itemType === "manual" && (
              <span
                className="ml-1.5 inline-flex translate-y-[-1px] items-center rounded-full border border-[#E0DCD6] bg-[#FAF7F2] px-1.5 py-[1px] align-middle text-[10px] font-normal text-muted-foreground"
                title="此工項為手動新增,不來自標單匯入"
              >
                手動
              </span>
            )}
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
          ) : editable ? (
            <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {showAdd && (
                <button
                  type="button"
                  onClick={() => onAdd?.(node.id)}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white hover:text-accent"
                  aria-label="在此分類下新增工項"
                  title="在此分類下新增工項"
                >
                  <Plus className="size-3.5" />
                </button>
              )}
              {showEdit && (
                <button
                  type="button"
                  onClick={() => onEdit?.(node.id)}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white hover:text-accent"
                  aria-label="編輯工項"
                  title="編輯"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
              {showDelete && (
                <button
                  type="button"
                  onClick={() => onDelete?.(node.id)}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white hover:text-[#B91C1C]"
                  aria-label="刪除工項"
                  title="刪除"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
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
              visibleIds={visibleIds}
              editable={editable}
              onEdit={onEdit}
              onDelete={onDelete}
              onAdd={onAdd}
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
