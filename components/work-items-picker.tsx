"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 行動裝置友善的工項勾選器 — 給工地主任填日誌用。
 * - 只能勾 item / spec / manual(section 只當分隔顯示,不能勾)
 * - 勾起來才出現數量輸入
 * - section 可摺疊
 */

export type PickerItem = {
  id: string;
  parentId: string | null;
  depth: number;
  itemType: "section" | "item" | "spec" | "manual";
  tenderCode: string | null;
  name: string;
  unit: string | null;
  totalQuantity: number | null;  // 標單原數量(供參考)
};

// PickerValue 跟 DB 的 DailyLogWorkItem shape 一致(work_item_id snake_case),
// 寫入時不需轉換
export type PickerValue = {
  work_item_id: string;
  qty: number;
  note?: string;
};

type Props = {
  items: PickerItem[];
  value: PickerValue[];
  onChange: (next: PickerValue[]) => void;
};

export function WorkItemsPicker({ items, value, onChange }: Props) {
  const byParent = useMemo(() => {
    const m = new Map<string | null, PickerItem[]>();
    for (const it of items) {
      const arr = m.get(it.parentId) ?? [];
      arr.push(it);
      m.set(it.parentId, arr);
    }
    return m;
  }, [items]);

  const valueMap = useMemo(() => {
    const m = new Map<string, PickerValue>();
    for (const v of value) m.set(v.work_item_id, v);
    return m;
  }, [value]);

  function setQty(id: string, qty: number | null) {
    const next = value.filter((v) => v.work_item_id !== id);
    if (qty !== null && qty > 0) next.push({ work_item_id: id, qty });
    onChange(next);
  }

  function toggle(id: string, checked: boolean) {
    if (checked) onChange([...value, { work_item_id: id, qty: 1 }]);
    else onChange(value.filter((v) => v.work_item_id !== id));
  }

  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.itemType === "section") set.add(it.id);
    }
    return set;
  }, [items]);
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  const toggleExpand = (id: string) =>
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const roots = byParent.get(null) ?? [];

  if (!items.length) {
    return (
      <div className="rounded-md border border-dashed border-[#E0DCD6] bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        此案件還沒匯入標單,請先請辦公室助理上傳標單
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[#E0DCD6] bg-card">
      <div className="divide-y divide-[#E0DCD6]">
        {roots.map((r) => (
          <PickerRow
            key={r.id}
            node={r}
            byParent={byParent}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            valueMap={valueMap}
            onToggle={toggle}
            onSetQty={setQty}
          />
        ))}
      </div>
    </div>
  );
}

function PickerRow({
  node,
  byParent,
  expanded,
  onToggleExpand,
  valueMap,
  onToggle,
  onSetQty,
}: {
  node: PickerItem;
  byParent: Map<string | null, PickerItem[]>;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  valueMap: Map<string, PickerValue>;
  onToggle: (id: string, checked: boolean) => void;
  onSetQty: (id: string, qty: number | null) => void;
}) {
  const children = byParent.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSection = node.itemType === "section";

  const v = valueMap.get(node.id);
  const checked = !!v;

  // section 整列可點摺疊;非 section 整列可點切換勾選(觸控目標 ≥ 48px 高)
  const handleRowClick = () => {
    if (isSection) {
      if (hasChildren) onToggleExpand(node.id);
      return;
    }
    onToggle(node.id, !checked);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRowClick();
          }
        }}
        className={cn(
          "flex min-h-[56px] cursor-pointer items-center gap-3 px-3 py-3 active:bg-[#F5F1EC]",
          isSection && "bg-[#FAF7F2]"
        )}
        style={{ paddingLeft: `${12 + node.depth * 14}px` }}
      >
        {/* 摺疊鈕 — 即使 section 整列可點,獨立小區仍給滑鼠使用者方便 */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-accent"
            aria-label={isOpen ? "收起" : "展開"}
          >
            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="inline-block size-8 shrink-0" />
        )}

        {/* checkbox(section 不顯示) — 視覺保留小,實際 hit area 由整列吃掉 */}
        {!isSection ? (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            tabIndex={-1}
            className="size-5 shrink-0 cursor-pointer accent-[#A07850] pointer-events-none"
          />
        ) : (
          <span className="inline-block size-5 shrink-0" />
        )}

        {/* 名稱 + 編碼 */}
        <div className="min-w-0 flex-1">
          {node.tenderCode && (
            <div className="font-mono text-xs text-muted-foreground">
              {node.tenderCode}
            </div>
          )}
          <div
            className={cn(
              "text-sm",
              isSection ? "font-semibold text-primary" : "text-foreground"
            )}
          >
            {node.name}
          </div>
          {node.totalQuantity !== null && !isSection && (
            <div className="text-xs text-muted-foreground">
              標單總量 {node.totalQuantity}
              {node.unit ? ` ${node.unit}` : ""}
            </div>
          )}
        </div>

        {/* 數量輸入(checked 才出現) — 加 stepper 方便戴手套 */}
        {checked && !isSection && (
          <div
            className="flex shrink-0 items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => onSetQty(node.id, Math.max(0, (v.qty ?? 0) - 1))}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-base text-[#5A5050] hover:bg-[#F5F1EC]"
              aria-label="減"
            >
              −
            </button>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={v.qty}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) onSetQty(node.id, n);
              }}
              className="h-10 w-20 rounded-md border border-[#E0DCD6] bg-white px-2 text-center text-base tabular-nums outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
            <button
              type="button"
              onClick={() => onSetQty(node.id, (v.qty ?? 0) + 1)}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-base text-[#5A5050] hover:bg-[#F5F1EC]"
              aria-label="加"
            >
              ＋
            </button>
            <span className="ml-1 text-xs text-muted-foreground">
              {node.unit ?? ""}
            </span>
          </div>
        )}
      </div>

      {hasChildren && isOpen
        ? children.map((c) => (
            <PickerRow
              key={c.id}
              node={c}
              byParent={byParent}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              valueMap={valueMap}
              onToggle={onToggle}
              onSetQty={onSetQty}
            />
          ))
        : null}
    </>
  );
}
