"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkItemAggregate } from "@/lib/work-item-aggregates";

/**
 * 工項勾選器(card-first 介面) — 給工地主任填日誌用。
 *
 * UI 分兩塊:
 *   1. 上方「已選工項」卡片區 — 編輯數量、切換模式、移除
 *   2. 下方「瀏覽全部工項」可摺疊區 — 樹狀結構,只負責勾選 / 取消勾選
 *
 * 行為:
 *   - 只有 item / spec / manual 可勾,section 只當分隔
 *   - 勾起來會出現在上方卡片區,預設 qty 依 unit 推測為 absolute 或 percent
 *   - 數量編輯只在卡片區,不在樹中
 *   - 樹只負責瀏覽/勾選,在已勾的 row 顯示「✓ 已選」標籤,點再次取消
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
  /** workItemId → 歷史累計與鎖定模式;若該工項從未被填過則無條目,UI 自由切換模式 */
  aggregates?: Record<string, WorkItemAggregate>;
};

export function WorkItemsPicker({ items, value, onChange, aggregates }: Props) {
  const [query, setQuery] = useState("");
  const [browserOpen, setBrowserOpen] = useState(value.length === 0);

  const itemMap = useMemo(() => {
    const m = new Map<string, PickerItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

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

  // 已選工項的「樹順序」— 用 sort_path 不存在但可以用 items 原本順序近似
  const selectedInOrder = useMemo(() => {
    const out: { item: PickerItem; value: PickerValue }[] = [];
    for (const it of items) {
      const v = valueMap.get(it.id);
      if (v) out.push({ item: it, value: v });
    }
    return out;
  }, [items, valueMap]);

  const visibleIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;

    const visible = new Set<string>();

    function addAncestors(id: string) {
      let cur = itemMap.get(id);
      while (cur?.parentId) {
        visible.add(cur.parentId);
        cur = itemMap.get(cur.parentId);
      }
    }

    function addDescendants(id: string) {
      const children = byParent.get(id) ?? [];
      for (const child of children) {
        visible.add(child.id);
        addDescendants(child.id);
      }
    }

    for (const item of items) {
      const haystack = `${item.tenderCode ?? ""} ${item.name} ${item.unit ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) continue;
      visible.add(item.id);
      addAncestors(item.id);
      addDescendants(item.id);
    }

    return visible;
  }, [byParent, itemMap, items, query]);

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
      const item = itemMap.get(id);
      const lockedMode = aggregates?.[id]?.mode;
      const mode = lockedMode ?? defaultModeForUnit(item?.unit ?? null);
      let qty = mode === "percent" ? 0.5 : 1;
      const priorTotal =
        aggregates?.[id] && aggregates[id].mode === mode
          ? aggregates[id].total
          : 0;
      const cap =
        mode === "percent"
          ? Math.max(0, 1 - priorTotal)
          : item?.totalQuantity != null
            ? Math.max(0, item.totalQuantity - priorTotal)
            : null;
      if (cap != null && qty > cap) qty = cap;
      onChange([...value, { work_item_id: id, qty, qty_mode: mode }]);
    } else {
      onChange(value.filter((v) => v.work_item_id !== id));
    }
  }

  function toggleMode(id: string) {
    const v = value.find((x) => x.work_item_id === id);
    if (!v) return;
    if (aggregates?.[id]) return;
    const nextMode = v.qty_mode === "percent" ? "absolute" : "percent";
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

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-4 py-10 text-center text-base text-muted-foreground">
        此案件還沒匯入標單,請先請辦公室助理上傳標單
      </div>
    );
  }

  const roots = byParent.get(null) ?? [];
  const visibleRoots = visibleIds
    ? roots.filter((r) => visibleIds.has(r.id))
    : roots;

  return (
    <div className="space-y-4">
      {/* 已選卡片區 */}
      {selectedInOrder.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-primary">
              已選 {selectedInOrder.length} 個工項
            </h3>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-muted-foreground transition-colors hover:text-[#B91C1C]"
            >
              全部移除
            </button>
          </div>
          <ul className="space-y-2.5">
            {selectedInOrder.map(({ item, value: v }) => (
              <li key={item.id}>
                <SelectedItemCard
                  item={item}
                  value={v}
                  aggregate={aggregates?.[item.id]}
                  onChangeQty={(qty) => setQty(item.id, qty)}
                  onToggleMode={() => toggleMode(item.id)}
                  onRemove={() => toggle(item.id, false)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 瀏覽器 */}
      <details
        open={browserOpen || query.trim().length > 0}
        onToggle={(e) => setBrowserOpen((e.target as HTMLDetailsElement).open)}
        className="rounded-lg border border-[#E0DCD6] bg-card"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-base font-medium text-primary [&::-webkit-details-marker]:hidden">
          <span>
            {selectedInOrder.length > 0 ? "+ 加更多工項" : "選擇工項"}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              （從標單裡挑）
            </span>
          </span>
          <span className="shrink-0 text-muted-foreground transition-transform duration-150 [details[open]_&]:rotate-180">
            <ChevronDown className="size-5" />
          </span>
        </summary>

        <div className="border-t border-[#E0DCD6] px-3 py-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋項次、工項名稱或單位"
            className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 md:h-12"
          />
        </div>
        {/* 手機:資料夾抽屜式 — 一次只看一層,深度不擠 */}
        <div className="md:hidden">
          <MobileBrowseView
            items={items}
            byParent={byParent}
            valueMap={valueMap}
            onToggle={toggle}
            query={query}
          />
        </div>

        {/* 桌機:樹狀展開 — 寬度足夠多層展開不會擠 */}
        <div className="hidden divide-y divide-[#E0DCD6] md:block">
          {visibleRoots.length === 0 ? (
            <div className="px-4 py-8 text-center text-base text-muted-foreground">
              找不到符合「{query}」的工項
            </div>
          ) : (
            visibleRoots.map((r) => (
              <BrowseRow
                key={r.id}
                node={r}
                byParent={byParent}
                expanded={expanded}
                visibleIds={visibleIds}
                forceExpand={query.trim().length > 0}
                onToggleExpand={toggleExpand}
                valueMap={valueMap}
                onToggle={toggle}
              />
            ))
          )}
        </div>
      </details>
    </div>
  );
}

/* =============================================================== */
/* 已選卡片 — 編輯數量 / 模式 / 移除                                  */
/* =============================================================== */

function SelectedItemCard({
  item,
  value: v,
  aggregate,
  onChangeQty,
  onToggleMode,
  onRemove,
}: {
  item: PickerItem;
  value: PickerValue;
  aggregate?: WorkItemAggregate;
  onChangeQty: (qty: number) => void;
  onToggleMode: () => void;
  onRemove: () => void;
}) {
  const isPct = v.qty_mode === "percent";
  const modeLocked = !!aggregate;
  const priorTotal =
    aggregate && aggregate.mode === v.qty_mode ? aggregate.total : 0;
  const fillCap = isPct
    ? Math.max(0, 1 - priorTotal)
    : item.totalQuantity != null
      ? Math.max(0, item.totalQuantity - priorTotal)
      : null;
  const clampStored = (n: number) => {
    if (n < 0) return 0;
    if (fillCap != null && n > fillCap) return fillCap;
    return n;
  };
  const display = isPct ? Math.round((v.qty ?? 0) * 100) : v.qty;
  const step = isPct ? 10 : 1;
  const onMinus = () => {
    const cur = isPct ? (v.qty ?? 0) * 100 : v.qty ?? 0;
    const next = Math.max(0, cur - step);
    onChangeQty(clampStored(isPct ? next / 100 : next));
  };
  const onPlus = () => {
    const cur = isPct ? (v.qty ?? 0) * 100 : v.qty ?? 0;
    const next = cur + step;
    onChangeQty(clampStored(isPct ? next / 100 : next));
  };
  const inputMax = isPct
    ? Math.round(Math.max(0, 1 - priorTotal) * 100)
    : fillCap ?? undefined;

  return (
    <div className="rounded-lg border-2 border-[#E0DCD6] bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {item.tenderCode && (
            <div className="font-mono text-xs text-muted-foreground">
              {item.tenderCode}
            </div>
          )}
          <div className="mt-0.5 text-base font-semibold leading-snug text-primary md:text-lg">
            {item.name}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {item.totalQuantity !== null && (
              <span>
                標單總量 {item.totalQuantity}
                {item.unit ? ` ${item.unit}` : ""}
              </span>
            )}
            {aggregate && (
              <span>
                目前累計{" "}
                <span className="font-medium text-foreground">
                  {formatAggregate(aggregate, item.unit, item.totalQuantity)}
                </span>
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-[#B91C1C] transition-colors hover:bg-[#FEF2F2]"
          aria-label="移除這個工項"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#F0EBE4] pt-3">
        <button
          type="button"
          onClick={() => {
            if (modeLocked) return;
            onToggleMode();
          }}
          disabled={modeLocked}
          aria-disabled={modeLocked}
          className={cn(
            "rounded-full border border-[#E0DCD6] bg-white px-3 py-1 text-xs text-muted-foreground transition-colors",
            modeLocked
              ? "cursor-not-allowed opacity-70"
              : "hover:bg-[#FAF7F2]"
          )}
          title={
            modeLocked
              ? `已鎖定為${isPct ? "百分比" : "實際數量"}模式`
              : isPct
                ? "切換為輸入實際數量"
                : "切換為輸入百分比"
          }
        >
          {isPct ? "% 百分比" : "量 實際數量"}
          {modeLocked ? " · 已鎖定" : ""}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMinus}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-lg text-[#5A5050] hover:bg-[#F5F1EC] active:bg-[#F0EBE4]"
            aria-label="減"
          >
            −
          </button>
          <input
            type="number"
            min={0}
            max={inputMax}
            step="any"
            inputMode="decimal"
            value={display}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              onChangeQty(clampStored(isPct ? n / 100 : n));
            }}
            className="h-11 w-20 rounded-md border border-[#E0DCD6] bg-white px-2 text-center text-base tabular-nums outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          <button
            type="button"
            onClick={onPlus}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-lg text-[#5A5050] hover:bg-[#F5F1EC] active:bg-[#F0EBE4]"
            aria-label="加"
          >
            ＋
          </button>
          <span className="ml-1 text-sm text-muted-foreground">
            {isPct ? "%" : item.unit ?? ""}
          </span>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        填寫後{" "}
        <span className="font-medium tabular-nums text-foreground">
          {formatAfterFill(v, aggregate, item.unit, item.totalQuantity)}
        </span>
      </div>
    </div>
  );
}

/* =============================================================== */
/* 瀏覽 row — 只負責勾選 / 取消勾選,沒有數量輸入                       */
/* =============================================================== */

function BrowseRow({
  node,
  byParent,
  expanded,
  visibleIds,
  forceExpand,
  onToggleExpand,
  valueMap,
  onToggle,
}: {
  node: PickerItem;
  byParent: Map<string | null, PickerItem[]>;
  expanded: Set<string>;
  visibleIds: Set<string> | null;
  forceExpand: boolean;
  onToggleExpand: (id: string) => void;
  valueMap: Map<string, PickerValue>;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const children = (byParent.get(node.id) ?? []).filter(
    (child) => !visibleIds || visibleIds.has(child.id)
  );
  const hasChildren = children.length > 0;
  const isOpen = forceExpand || expanded.has(node.id);
  const isSection = node.itemType === "section";

  const checked = valueMap.has(node.id);

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
          "flex min-h-[52px] cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors active:bg-[#F5F1EC]",
          isSection && "bg-[#FAF7F2]",
          checked && !isSection && "bg-[#FAF7F2]"
        )}
        style={{ paddingLeft: `${12 + node.depth * 14}px` }}
      >
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

        <div className="min-w-0 flex-1">
          {node.tenderCode && (
            <div className="font-mono text-xs text-muted-foreground">
              {node.tenderCode}
            </div>
          )}
          <div
            className={cn(
              "text-base leading-snug",
              isSection ? "font-semibold text-primary" : "font-medium text-foreground"
            )}
          >
            {node.name}
          </div>
          {node.totalQuantity !== null && !isSection && (
            <div className="text-xs text-muted-foreground">
              {node.totalQuantity}
              {node.unit ? ` ${node.unit}` : ""}
            </div>
          )}
        </div>

        {checked && !isSection && (
          <span className="shrink-0 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-xs font-medium text-[#4A7C59]">
            ✓ 已選
          </span>
        )}
      </div>

      {hasChildren && isOpen
        ? children.map((c) => (
            <BrowseRow
              key={c.id}
              node={c}
              byParent={byParent}
              expanded={expanded}
              visibleIds={visibleIds}
              forceExpand={forceExpand}
              onToggleExpand={onToggleExpand}
              valueMap={valueMap}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
}

/* =============================================================== */
/* 手機抽屜式瀏覽 — 一次只顯示一層,深度不會擠                        */
/* =============================================================== */

function MobileBrowseView({
  items,
  byParent,
  valueMap,
  onToggle,
  query,
}: {
  items: PickerItem[];
  byParent: Map<string | null, PickerItem[]>;
  valueMap: Map<string, PickerValue>;
  onToggle: (id: string, checked: boolean) => void;
  query: string;
}) {
  const [path, setPath] = useState<PickerItem[]>([]);

  // 搜尋中:忽略 path,顯示扁平結果(只可勾選的 item / spec / manual)
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    const matches = items.filter((it) => {
      if (it.itemType === "section") return false;
      const haystack = `${it.tenderCode ?? ""} ${it.name} ${it.unit ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
    if (matches.length === 0) {
      return (
        <div className="px-4 py-8 text-center text-base text-muted-foreground">
          找不到符合「{query}」的工項
        </div>
      );
    }
    return (
      <ul className="divide-y divide-[#E0DCD6]">
        {matches.map((it) => (
          <MobileItemRow
            key={it.id}
            item={it}
            checked={valueMap.has(it.id)}
            onToggle={() => onToggle(it.id, !valueMap.has(it.id))}
          />
        ))}
      </ul>
    );
  }

  const currentParentId = path.length === 0 ? null : path[path.length - 1].id;
  const currentChildren = byParent.get(currentParentId) ?? [];

  return (
    <div>
      {path.length > 0 && (
        <div className="border-b border-[#E0DCD6] bg-[#FAF7F2] px-3 py-2.5">
          <button
            type="button"
            onClick={() => setPath((p) => p.slice(0, -1))}
            className="inline-flex min-h-[36px] items-center gap-1.5 text-sm font-medium text-accent active:opacity-70"
          >
            <ChevronLeft className="size-4" /> 上一層
          </button>
          <div className="mt-1 break-words text-sm text-muted-foreground">
            {path.map((p) => p.name).join(" › ")}
          </div>
        </div>
      )}
      {currentChildren.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          這層裡沒有工項
        </div>
      ) : (
        <ul className="divide-y divide-[#E0DCD6]">
          {currentChildren.map((child) =>
            child.itemType === "section" ? (
              <MobileSectionRow
                key={child.id}
                section={child}
                count={countDescendantSelectables(byParent, child.id)}
                selectedCount={countSelectedDescendants(byParent, child.id, valueMap)}
                onTap={() => setPath((p) => [...p, child])}
              />
            ) : (
              <MobileItemRow
                key={child.id}
                item={child}
                checked={valueMap.has(child.id)}
                onToggle={() => onToggle(child.id, !valueMap.has(child.id))}
              />
            )
          )}
        </ul>
      )}
    </div>
  );
}

function MobileSectionRow({
  section,
  count,
  selectedCount,
  onTap,
}: {
  section: PickerItem;
  count: number;
  selectedCount: number;
  onTap: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-[#F5F1EC]"
      >
        <div className="min-w-0 flex-1">
          {section.tenderCode && (
            <div className="font-mono text-xs text-muted-foreground">
              {section.tenderCode}
            </div>
          )}
          <div className="break-words text-base font-semibold leading-snug text-primary">
            {section.name}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {count > 0 ? `${count} 個工項` : "無工項"}
            {selectedCount > 0 && (
              <span className="ml-2 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-1.5 py-0.5 text-[#4A7C59]">
                已選 {selectedCount}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function MobileItemRow({
  item,
  checked,
  onToggle,
}: {
  item: PickerItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-[#F5F1EC]",
          checked && "bg-[#FAF7F2]"
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          readOnly
          tabIndex={-1}
          className="mt-1 size-5 shrink-0 cursor-pointer accent-[#A07850] pointer-events-none"
        />
        <div className="min-w-0 flex-1">
          {item.tenderCode && (
            <div className="font-mono text-xs text-muted-foreground">
              {item.tenderCode}
            </div>
          )}
          <div className="break-words text-base font-medium leading-snug text-foreground">
            {item.name}
          </div>
          {item.totalQuantity !== null && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {item.totalQuantity}
              {item.unit ? ` ${item.unit}` : ""}
            </div>
          )}
        </div>
        {checked && (
          <span className="mt-0.5 shrink-0 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-xs font-medium text-[#4A7C59]">
            ✓
          </span>
        )}
      </button>
    </li>
  );
}

function countDescendantSelectables(
  byParent: Map<string | null, PickerItem[]>,
  id: string
): number {
  let count = 0;
  const children = byParent.get(id) ?? [];
  for (const child of children) {
    if (child.itemType !== "section") count++;
    count += countDescendantSelectables(byParent, child.id);
  }
  return count;
}

function countSelectedDescendants(
  byParent: Map<string | null, PickerItem[]>,
  id: string,
  valueMap: Map<string, PickerValue>
): number {
  let count = 0;
  const children = byParent.get(id) ?? [];
  for (const child of children) {
    if (child.itemType !== "section" && valueMap.has(child.id)) count++;
    count += countSelectedDescendants(byParent, child.id, valueMap);
  }
  return count;
}

/* =============================================================== */

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString();
}

function formatAggregate(
  agg: WorkItemAggregate,
  unit: string | null,
  totalQuantity: number | null,
): string {
  if (agg.mode === "percent") {
    return `${formatNumber(agg.total * 100)}%`;
  }
  const base = `${formatNumber(agg.total)}${unit ? ` ${unit}` : ""}`;
  if (totalQuantity && totalQuantity > 0) {
    const pct = formatNumber((agg.total / totalQuantity) * 100);
    return `${base}（${pct}%）`;
  }
  return base;
}

function formatAfterFill(
  v: PickerValue,
  agg: WorkItemAggregate | undefined,
  unit: string | null,
  totalQuantity: number | null,
): string {
  const fillQty = Number.isFinite(v.qty) ? v.qty : 0;
  const mode = v.qty_mode ?? "absolute";
  const priorTotal = agg && agg.mode === mode ? agg.total : 0;
  const next = priorTotal + fillQty;
  if (mode === "percent") {
    return `${formatNumber(next * 100)}%`;
  }
  const base = `${formatNumber(next)}${unit ? ` ${unit}` : ""}`;
  if (totalQuantity && totalQuantity > 0) {
    const pct = formatNumber((next / totalQuantity) * 100);
    return `${base}（${pct}%）`;
  }
  return base;
}
