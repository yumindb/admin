"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkItemAggregate } from "@/lib/work-item-aggregates";

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
  /** workItemId → 歷史累計與鎖定模式;若該工項從未被填過則無條目,UI 自由切換模式 */
  aggregates?: Record<string, WorkItemAggregate>;
};

export function WorkItemsPicker({ items, value, onChange, aggregates }: Props) {
  const [query, setQuery] = useState("");
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

  const visibleIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;

    const itemMap = new Map(items.map((it) => [it.id, it]));
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
  }, [byParent, items, query]);

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
      // 已被歷史日誌鎖定的工項,只能用同一 mode;否則依 unit 推斷
      const lockedMode = aggregates?.[id]?.mode;
      const mode = lockedMode ?? defaultModeForUnit(item?.unit ?? null);
      // percent mode default 是 50% (0.5),absolute mode default 是 1
      let qty = mode === "percent" ? 0.5 : 1;
      // 不能讓初始值就超過剩餘可填空間(總計 ≤ 100%)
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
    // 已鎖定就不能切;此 fn 在 UI 層也不會被呼叫到,留 guard 防呆
    if (aggregates?.[id]) return;
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
  const visibleRoots = visibleIds
    ? roots.filter((r) => visibleIds.has(r.id))
    : roots;

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-4 py-10 text-center text-base text-muted-foreground">
        此案件還沒匯入標單,請先請辦公室助理上傳標單
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#E0DCD6] bg-card">
      <div className="border-b border-[#E0DCD6] px-3 py-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋項次、工項名稱或單位"
          className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 md:h-12"
        />
      </div>
      <div className="divide-y divide-[#E0DCD6]">
        {visibleRoots.length === 0 ? (
          <div className="px-4 py-8 text-center text-base text-muted-foreground">
            找不到符合「{query}」的工項
          </div>
        ) : visibleRoots.map((r) => (
          <PickerRow
            key={r.id}
            node={r}
            byParent={byParent}
            expanded={expanded}
            visibleIds={visibleIds}
            forceExpand={query.trim().length > 0}
            onToggleExpand={toggleExpand}
            valueMap={valueMap}
            onToggle={toggle}
            onSetQty={setQty}
            onToggleMode={toggleMode}
            aggregates={aggregates}
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
  visibleIds,
  forceExpand,
  onToggleExpand,
  valueMap,
  onToggle,
  onSetQty,
  onToggleMode,
  aggregates,
}: {
  node: PickerItem;
  byParent: Map<string | null, PickerItem[]>;
  expanded: Set<string>;
  visibleIds: Set<string> | null;
  forceExpand: boolean;
  onToggleExpand: (id: string) => void;
  valueMap: Map<string, PickerValue>;
  onToggle: (id: string, checked: boolean) => void;
  onSetQty: (id: string, qty: number | null) => void;
  onToggleMode: (id: string) => void;
  aggregates?: Record<string, WorkItemAggregate>;
}) {
  const children = (byParent.get(node.id) ?? []).filter(
    (child) => !visibleIds || visibleIds.has(child.id)
  );
  const hasChildren = children.length > 0;
  const isOpen = forceExpand || expanded.has(node.id);
  const isSection = node.itemType === "section";

  const v = valueMap.get(node.id);
  const checked = !!v;
  const aggregate = aggregates?.[node.id];
  const modeLocked = !!aggregate;

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
          "flex min-h-[56px] cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 active:bg-[#F5F1EC] md:flex-nowrap",
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
            <div className="font-mono text-sm text-muted-foreground">
              {node.tenderCode}
            </div>
          )}
          <div
            className={cn(
              "text-lg leading-snug",
              isSection ? "font-semibold text-primary" : "font-medium text-foreground"
            )}
          >
            {node.name}
          </div>
          {node.totalQuantity !== null && !isSection && (
            <div className="text-sm text-muted-foreground">
              標單總量 {node.totalQuantity}
              {node.unit ? ` ${node.unit}` : ""}
            </div>
          )}
          {!isSection && aggregate && (
            <div className="text-xs text-muted-foreground">
              目前累計{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatAggregate(aggregate, node.unit, node.totalQuantity)}
              </span>
            </div>
          )}
        </div>

        {/* 數量輸入(checked 才出現) — 加 stepper 方便戴手套 */}
        {checked && !isSection && (
          <div
            className="flex w-full shrink-0 flex-col items-end gap-1 md:ml-auto md:w-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* mode 切換:% / 量(歷史已填則鎖定,只能用同一模式) */}
            <button
              type="button"
              onClick={() => {
                if (modeLocked) return;
                onToggleMode(node.id);
              }}
              disabled={modeLocked}
              aria-disabled={modeLocked}
              className={cn(
                "rounded-full border border-[#E0DCD6] bg-white px-2.5 py-0.5 text-xs text-muted-foreground transition-colors",
                modeLocked
                  ? "cursor-not-allowed opacity-70"
                  : "hover:bg-[#FAF7F2]"
              )}
              title={
                modeLocked
                  ? `已鎖定為${v.qty_mode === "percent" ? "百分比" : "實際數量"}模式(此工項先前填寫已使用此模式)`
                  : v.qty_mode === "percent"
                    ? "切換為輸入實際數量"
                    : "切換為輸入百分比"
              }
            >
              {v.qty_mode === "percent" ? "% 模式" : "量 模式"}
              {modeLocked ? " · 已鎖定" : ""}
            </button>

            <div className="flex items-center gap-1">
              {(() => {
                const isPct = v.qty_mode === "percent";
                // 同 mode 才能加入歷史累計;否則本次當第一筆
                const priorTotal =
                  aggregate && aggregate.mode === v.qty_mode
                    ? aggregate.total
                    : 0;
                // 本次填寫上限:absolute=標單總量-priorTotal;percent=1-priorTotal
                // 不限總量(totalQuantity 為 null 的 absolute 工項)就不設上限
                const fillCap = isPct
                  ? Math.max(0, 1 - priorTotal)
                  : node.totalQuantity != null
                    ? Math.max(0, node.totalQuantity - priorTotal)
                    : null;
                const clampStored = (n: number) => {
                  if (n < 0) return 0;
                  if (fillCap != null && n > fillCap) return fillCap;
                  return n;
                };
                // percent mode:畫面 0-100,儲存 0-1
                const display = isPct ? Math.round((v.qty ?? 0) * 100) : v.qty;
                const step = isPct ? 10 : 1;
                const onMinus = () => {
                  const cur = isPct ? (v.qty ?? 0) * 100 : v.qty ?? 0;
                  const next = Math.max(0, cur - step);
                  onSetQty(node.id, clampStored(isPct ? next / 100 : next));
                };
                const onPlus = () => {
                  const cur = isPct ? (v.qty ?? 0) * 100 : v.qty ?? 0;
                  const next = cur + step;
                  onSetQty(node.id, clampStored(isPct ? next / 100 : next));
                };
                // input max 給原生瀏覽器提示;真實限制在 onChange clamp
                const inputMax = isPct
                  ? Math.round(Math.max(0, 1 - priorTotal) * 100)
                  : fillCap ?? undefined;
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
                      max={inputMax}
                      step="any"
                      inputMode="decimal"
                      value={display}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        onSetQty(node.id, clampStored(isPct ? n / 100 : n));
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

            {/* 填寫後累計即時試算 */}
            <div className="text-xs text-muted-foreground">
              填寫後{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatAfterFill(
                  v,
                  aggregate,
                  node.unit,
                  node.totalQuantity,
                )}
              </span>
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
              visibleIds={visibleIds}
              forceExpand={forceExpand}
              onToggleExpand={onToggleExpand}
              valueMap={valueMap}
              onToggle={onToggle}
              onSetQty={onSetQty}
              onToggleMode={onToggleMode}
              aggregates={aggregates}
            />
          ))
        : null}
    </>
  );
}

function formatNumber(n: number): string {
  // 去除多餘小數,但保留最多 2 位
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
  // 鎖定模式 + 同 mode 才能加;否則只顯示本次填寫值(極少數 legacy 模式衝突情境)
  const priorTotal =
    agg && agg.mode === mode ? agg.total : 0;
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
