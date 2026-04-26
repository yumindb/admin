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
  qty: number;                              // 絕對量(percent mode 時是 0-1 的 fraction)
  qty_mode?: "absolute" | "percent";        // 預設 absolute
  note?: string;
};

// 哪些 unit 預設用百分比模式(整批/整組性質的工項)
const PERCENT_DEFAULT_UNITS = new Set([
  "組", "式", "套", "個", "處", "批", "戶", "棟",
  "件", "台", "部", "項", "座", "間",
]);

function defaultModeForUnit(unit: string | null): "absolute" | "percent" {
  if (!unit) return "absolute";
  return PERCENT_DEFAULT_UNITS.has(unit.trim()) ? "percent" : "absolute";
}

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

  function patchValue(id: string, patch: Partial<PickerValue>) {
    const idx = value.findIndex((v) => v.work_item_id === id);
    if (idx < 0) return;
    const next = [...value];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function setQty(id: string, qty: number | null) {
    const next = value.filter((v) => v.work_item_id !== id);
    if (qty !== null && qty > 0) {
      const existing = value.find((v) => v.work_item_id === id);
      next.push({
        work_item_id: id,
        qty,
        qty_mode: existing?.qty_mode,
      });
    }
    onChange(next);
  }

  function toggle(id: string, checked: boolean) {
    if (checked) {
      const item = items.find((it) => it.id === id);
      const mode = defaultModeForUnit(item?.unit ?? null);
      // percent mode default 是 50% (0.5),absolute mode default 是 1
      const qty = mode === "percent" ? 0.5 : 1;
      onChange([...value, { work_item_id: id, qty, qty_mode: mode }]);
    } else {
      onChange(value.filter((v) => v.work_item_id !== id));
    }
  }

  function toggleMode(id: string) {
    const v = value.find((x) => x.work_item_id === id);
    if (!v) return;
    const nextMode = v.qty_mode === "percent" ? "absolute" : "percent";
    // 模式切換時 qty 重置成該 mode 的 default,避免使用者誤把 30(米)當成 30(%)
    const nextQty = nextMode === "percent" ? 0.5 : 1;
    patchValue(id, { qty_mode: nextMode, qty: nextQty });
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
            onToggleMode={toggleMode}
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
  onToggleMode,
}: {
  node: PickerItem;
  byParent: Map<string | null, PickerItem[]>;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  valueMap: Map<string, PickerValue>;
  onToggle: (id: string, checked: boolean) => void;
  onSetQty: (id: string, qty: number | null) => void;
  onToggleMode: (id: string) => void;
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
            className="flex shrink-0 flex-col items-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {/* mode 切換:% / 量 */}
            <button
              type="button"
              onClick={() => onToggleMode(node.id)}
              className="rounded-full border border-[#E0DCD6] bg-white px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-[#FAF7F2]"
              title={
                v.qty_mode === "percent"
                  ? "切換為輸入實際數量"
                  : "切換為輸入百分比"
              }
            >
              {v.qty_mode === "percent" ? "% 模式" : "量 模式"}
            </button>

            <div className="flex items-center gap-1">
              {(() => {
                const isPct = v.qty_mode === "percent";
                // percent mode:畫面 0-100,儲存 0-1
                const display = isPct ? Math.round((v.qty ?? 0) * 100) : v.qty;
                const step = isPct ? 10 : 1;
                const onMinus = () => {
                  const cur = isPct ? (v.qty ?? 0) * 100 : v.qty ?? 0;
                  const next = Math.max(0, cur - step);
                  onSetQty(node.id, isPct ? next / 100 : next);
                };
                const onPlus = () => {
                  const cur = isPct ? (v.qty ?? 0) * 100 : v.qty ?? 0;
                  const next = isPct ? Math.min(100, cur + step) : cur + step;
                  onSetQty(node.id, isPct ? next / 100 : next);
                };
                return (
                  <>
                    <button
                      type="button"
                      onClick={onMinus}
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-base text-[#5A5050] hover:bg-[#F5F1EC]"
                      aria-label="減"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={isPct ? 100 : undefined}
                      step="any"
                      inputMode="decimal"
                      value={display}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        onSetQty(node.id, isPct ? n / 100 : n);
                      }}
                      className="h-10 w-20 rounded-md border border-[#E0DCD6] bg-white px-2 text-center text-base tabular-nums outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
                    />
                    <button
                      type="button"
                      onClick={onPlus}
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-base text-[#5A5050] hover:bg-[#F5F1EC]"
                      aria-label="加"
                    >
                      ＋
                    </button>
                    <span className="ml-1 w-8 text-xs text-muted-foreground">
                      {isPct ? "%" : node.unit ?? ""}
                    </span>
                  </>
                );
              })()}
            </div>
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
              onToggleMode={onToggleMode}
            />
          ))
        : null}
    </>
  );
}
