"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  totalQuantity: number | null;  // 標單原數量（供參考）
};

// PickerValue 跟 DB 的 DailyLogWorkItem shape 一致(work_item_id snake_case),
// 寫入時不需轉換
export type PickerValue = {
  work_item_id: string;
  qty: number;                              // 絕對量（percent mode 時是 0-1 的 fraction）
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

/**
 * 工地主任輸入超量(累計 + 本日 > 契約量)時的事件。父元件接到後可以彈
 * 「是否建立追加工項?」dialog,確認後把超量分到新建的未簽約工項。
 */
export type OverflowAttempt = {
  item: PickerItem;
  /** 使用者剛才按下的「想填的數量」(已 normalize 到絕對量;百分比模式為 0-1 fraction) */
  requested: number;
  /** 此工項剩餘可填的量(0 表示已填滿)。requested 一定 > cap。 */
  cap: number;
  /** 此次填寫的模式:absolute / percent */
  mode: "absolute" | "percent";
};

type Props = {
  items: PickerItem[];
  value: PickerValue[];
  onChange: (next: PickerValue[]) => void;
  /** workItemId → 歷史累計與鎖定模式;若該工項從未被填過則無條目,UI 自由切換模式 */
  aggregates?: Record<string, WorkItemAggregate>;
  /** 主任輸入超出剩餘量時觸發 — 父元件可以彈 dialog 詢問是否建立追加工項 */
  onOverflow?: (attempt: OverflowAttempt) => void;
  /** 新增臨時項 / overflow split 後高亮 + 滾動到該工項卡片 — 設了會自動清除 */
  highlightItemId?: string | null;
  onHighlightConsumed?: () => void;
};

export function WorkItemsPicker({
  items,
  value,
  onChange,
  aggregates,
  onOverflow,
  highlightItemId,
  onHighlightConsumed,
}: Props) {
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

  // 已完成的工項不再顯示在選擇器中(歷史累計已達標單量或 100%)。
  // 1) leaf:isWorkItemCompleted = false 才放進 set
  // 2) section:有任一 renderable 後代就放進(否則整節隱藏,避免顯示空 section)
  const renderableIds = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.itemType !== "section") {
        if (!isWorkItemCompleted(it, aggregates?.[it.id])) set.add(it.id);
      }
    }
    const sectionDecided = new Set<string>();
    function decide(id: string) {
      if (sectionDecided.has(id)) return;
      sectionDecided.add(id);
      const kids = byParent.get(id) ?? [];
      let hasVisible = false;
      for (const k of kids) {
        if (k.itemType === "section") decide(k.id);
        if (set.has(k.id)) hasVisible = true;
      }
      if (hasVisible) set.add(id);
    }
    for (const it of items) {
      if (it.itemType === "section") decide(it.id);
    }
    return set;
  }, [items, byParent, aggregates]);

  // 已選工項的「樹順序」— 用 sort_path 不存在但可以用 items 原本順序近似。
  // 同時計算每個項目的祖先名稱鏈,讓卡片顯示「電氣 › 配線管路 › PVC 管」這種上下文,
  // 避免最終工項名只是「1/2" (E19)」這種看不出類別的情況。
  const selectedInOrder = useMemo(() => {
    const out: { item: PickerItem; value: PickerValue; parentPath: string[] }[] = [];
    for (const it of items) {
      const v = valueMap.get(it.id);
      if (!v) continue;
      const path: string[] = [];
      let cur = it.parentId ? itemMap.get(it.parentId) : null;
      while (cur) {
        path.unshift(cur.name);
        cur = cur.parentId ? itemMap.get(cur.parentId) : null;
      }
      out.push({ item: it, value: v, parentPath: path });
    }
    return out;
  }, [items, valueMap, itemMap]);

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
    // 數量改 0 不會自動移除(改動由 trash 按鈕觸發);保留條目讓使用者可以再加回去
    const idx = value.findIndex((v) => v.work_item_id === id);
    if (idx < 0) return;
    const safe = qty === null || !Number.isFinite(qty) || qty < 0 ? 0 : qty;
    const next = [...value];
    next[idx] = { ...next[idx], qty: safe };
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

  // 用「collapsed set」(被折疊的)而不是「expanded set」(被展開的):
  //   - 預設全部展開,使用者要看哪一節時不用先點(除非他自己折起來過)
  //   - 切換案件時不會留下 stale 舊 IDs 影響新案件的預設展開狀態
  //   - 點開單通道時自動把整條 single-section 子鏈也撤掉折疊,省下逐層點擊
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // 展開:也把下方單通道整條一併展開(只有一個 section 子節點 → 跟著撤掉折疊)
        next.delete(id);
        let cur = id;
        while (true) {
          const kids = byParent.get(cur) ?? [];
          if (kids.length === 1 && kids[0].itemType === "section") {
            next.delete(kids[0].id);
            cur = kids[0].id;
          } else {
            break;
          }
        }
      } else {
        next.add(id);
      }
      return next;
    });

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-4 py-10 text-center text-base text-muted-foreground">
        此案件還沒匯入工項，請先請辦公室助理匯入
      </div>
    );
  }

  const roots = byParent.get(null) ?? [];
  const visibleRoots = roots.filter(
    (r) => renderableIds.has(r.id) && (!visibleIds || visibleIds.has(r.id)),
  );

  return (
    <div className="space-y-4">
      {/* 已選卡片區 — 視覺強調這裡是重點 */}
      {selectedInOrder.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b-2 border-[#A07850]/30 pb-2">
            <h3 className="flex items-center gap-2 text-lg font-bold text-primary">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-[#A07850] text-sm font-semibold text-white">
                {selectedInOrder.length}
              </span>
              今天要填的工項
            </h3>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-muted-foreground transition-colors hover:text-[#B91C1C]"
            >
              全部移除
            </button>
          </div>
          <ul className="space-y-2">
            {selectedInOrder.map(({ item, value: v, parentPath }) => (
              <li key={item.id}>
                <SelectedItemCard
                  item={item}
                  parentPath={parentPath}
                  value={v}
                  aggregate={aggregates?.[item.id]}
                  onChangeQty={(qty) => setQty(item.id, qty)}
                  onToggleMode={() => toggleMode(item.id)}
                  onRemove={() => toggle(item.id, false)}
                  onOverflow={onOverflow}
                  highlight={highlightItemId === item.id}
                  onHighlightConsumed={onHighlightConsumed}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 瀏覽器 — 搜尋框常駐；「瀏覽全部」用 details 折疊。
          已選 ≥1 後預設收起，但搜尋框永遠在頂部不需要先點才能找工項。 */}
      <div className="rounded-lg border border-[#E0DCD6] bg-card">
        <div className="px-3 py-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋項次、工項名稱或單位"
            className="h-11 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 md:h-12"
          />
        </div>

        <details
          open={browserOpen || query.trim().length > 0}
          onToggle={(e) => setBrowserOpen((e.target as HTMLDetailsElement).open)}
          className="border-t border-[#E0DCD6]"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base font-medium text-primary [&::-webkit-details-marker]:hidden">
            <span>
              瀏覽全部工項
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                （從匯入的工項挑）
              </span>
            </span>
            <span className="shrink-0 text-muted-foreground transition-transform duration-150 [details[open]_&]:rotate-180">
              <ChevronDown className="size-5" />
            </span>
          </summary>

          {/* 手機：資料夾抽屜式 — 一次只看一層，深度不擠 */}
          <div className="md:hidden">
            <MobileBrowseView
              items={items}
              byParent={byParent}
              valueMap={valueMap}
              onToggle={toggle}
              query={query}
              renderableIds={renderableIds}
            />
          </div>

          {/* 桌機：樹狀展開 — 寬度足夠多層展開不會擠 */}
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
                  collapsed={collapsed}
                  visibleIds={visibleIds}
                  renderableIds={renderableIds}
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
    </div>
  );
}

/* =============================================================== */
/* 已選卡片 — 編輯數量 / 模式 / 移除                                  */
/* =============================================================== */

function SelectedItemCard({
  item,
  parentPath,
  value: v,
  aggregate,
  onChangeQty,
  onToggleMode,
  onRemove,
  onOverflow,
  highlight = false,
  onHighlightConsumed,
}: {
  item: PickerItem;
  parentPath: string[];
  value: PickerValue;
  aggregate?: WorkItemAggregate;
  onChangeQty: (qty: number) => void;
  onToggleMode: () => void;
  onRemove: () => void;
  /** 父元件監聽超量輸入(只在 cap 是有限值時才會觸發) */
  onOverflow?: (attempt: OverflowAttempt) => void;
  /** 新增臨時項 / overflow split 後對該卡片高亮 + 滾動到 view */
  highlight?: boolean;
  onHighlightConsumed?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  // 高亮被觸發時 scroll into view + 2.5 秒後通知父元件清掉(避免一直閃)
  useEffect(() => {
    if (!highlight) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => onHighlightConsumed?.(), 2500);
    return () => clearTimeout(t);
  }, [highlight, onHighlightConsumed]);
  const isPct = v.qty_mode === "percent";
  const modeLocked = !!aggregate;
  const priorTotal =
    aggregate && aggregate.mode === v.qty_mode ? aggregate.total : 0;
  const fillCap = isPct
    ? Math.max(0, 1 - priorTotal)
    : item.totalQuantity != null
      ? Math.max(0, item.totalQuantity - priorTotal)
      : null;
  // clampStored:把 stored 值夾在 [0, fillCap] 之間;超出 cap 時觸發 onOverflow。
  // 父元件 handleOverflow 有 dedupe(dialog 已開就忽略),所以連按 + 也不會疊跳。
  const clampStored = (n: number) => {
    if (n < 0) return 0;
    if (fillCap != null && n > fillCap) {
      if (onOverflow) {
        onOverflow({ item, requested: n, cap: fillCap, mode: v.qty_mode ?? "absolute" });
      }
      return fillCap;
    }
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
  // 數字輸入框拿掉 max 限制 — 讓使用者能打超過 cap 的數字觸發 dialog。
  // 仍給 step+min,避免負數/非數字。
  const inputMax = undefined;

  // 進度條:percent 模式以 1 為分母,absolute 模式以標單數量為分母。
  // 沒有分母時(absolute 模式且無標單量)不顯示進度條。
  const progressDenom = isPct ? 1 : item.totalQuantity ?? 0;
  const showProgress = progressDenom > 0;
  const fillQty = Number.isFinite(v.qty) ? v.qty : 0;
  const priorPct = showProgress ? Math.min(1, priorTotal / progressDenom) : 0;
  const addedPct = showProgress
    ? Math.min(1 - priorPct, Math.max(0, fillQty / progressDenom))
    : 0;
  const totalPct = priorPct + addedPct;

  return (
    <div
      ref={cardRef}
      className={cn(
        "overflow-hidden rounded-lg border bg-[#FAF7F2] shadow-sm transition-all duration-300",
        highlight
          ? "border-2 border-accent ring-4 ring-accent/30 shadow-md"
          : "border border-[#A07850]/40",
      )}
    >
      {showProgress && (
        <div
          className="relative h-1 w-full bg-[#E8DFD3]"
          aria-label={`填寫後 ${Math.round(totalPct * 100)}%`}
          role="progressbar"
          aria-valuenow={Math.round(totalPct * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {priorPct > 0 && (
            <div
              className="absolute left-0 top-0 h-full bg-[#C9B59A]"
              style={{ width: `${priorPct * 100}%` }}
            />
          )}
          {addedPct > 0 && (
            <div
              className="absolute top-0 h-full bg-[#A07850]"
              style={{
                left: `${priorPct * 100}%`,
                width: `${addedPct * 100}%`,
              }}
            />
          )}
        </div>
      )}
      <div className="p-3">
      {/* 第一列：工項名 + 移除 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {parentPath.length > 0 && (
            <div className="mb-0.5 break-words text-xs leading-tight text-muted-foreground">
              {parentPath.join(" › ")}
            </div>
          )}
          <div className="break-words text-base font-semibold leading-snug text-primary">
            {item.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {item.tenderCode && (
              <span className="font-mono">{item.tenderCode}</span>
            )}
            {item.totalQuantity !== null && (
              <span>
                · 共 {item.totalQuantity}
                {item.unit ? ` ${item.unit}` : ""}
              </span>
            )}
            {aggregate && (
              <span>
                · 累計{" "}
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
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-[#B91C1C] transition-colors hover:bg-[#FEF2F2] active:bg-[#FCE7E7]"
          aria-label="移除這個工項"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* 第二列：數量 + 模式 segmented control */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {/* 戴手套手指誤觸 -/+ 的機率很高，所以 stepper 加大到 44px (Apple HIG) + gap-2 */}
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
            className="h-11 w-20 rounded-md border border-[#E0DCD6] bg-white px-1 text-center text-base tabular-nums outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          <button
            type="button"
            onClick={onPlus}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-[#E0DCD6] bg-white text-lg text-[#5A5050] hover:bg-[#F5F1EC] active:bg-[#F0EBE4]"
            aria-label="加"
          >
            ＋
          </button>
        </div>

        <ModeSegment
          isPct={isPct}
          locked={modeLocked}
          unit={item.unit}
          onSwitch={onToggleMode}
        />
      </div>

      </div>
    </div>
  );
}

function ModeSegment({
  isPct,
  locked,
  unit,
  onSwitch,
}: {
  isPct: boolean;
  locked: boolean;
  unit: string | null;
  onSwitch: () => void;
}) {
  // 用兩個並排的按鈕做 segmented control;active 那邊填銅金底色,
  // 一眼就看得出「兩個模式可切換」。鎖定狀態時整個變半透明,點擊無效。
  const segBase =
    "inline-flex h-11 items-center justify-center px-3 text-sm font-medium transition-colors";
  return (
    <div
      className={cn(
        "inline-flex overflow-hidden rounded-md border border-[#E0DCD6] bg-white",
        locked && "opacity-60"
      )}
      role="tablist"
      aria-label="輸入模式"
      title={
        locked
          ? `已鎖定為${isPct ? "百分比" : "實際數量"}模式（歷史日誌已使用此模式）`
          : "點選切換輸入模式"
      }
    >
      <button
        type="button"
        role="tab"
        aria-selected={isPct}
        aria-label="百分比"
        disabled={locked || isPct}
        onClick={() => {
          if (!locked && !isPct) onSwitch();
        }}
        className={cn(
          segBase,
          isPct
            ? "bg-[#A07850] text-white"
            : "text-muted-foreground hover:bg-[#F5F1EC]"
        )}
      >
        %
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={!isPct}
        aria-label={`實際數量${unit ? `(${unit})` : ""}`}
        disabled={locked || !isPct}
        onClick={() => {
          if (!locked && isPct) onSwitch();
        }}
        className={cn(
          segBase,
          "border-l border-[#E0DCD6]",
          !isPct
            ? "bg-[#A07850] text-white"
            : "text-muted-foreground hover:bg-[#F5F1EC]"
        )}
      >
        {unit || "數量"}
      </button>
    </div>
  );
}

/* =============================================================== */
/* 瀏覽 row — 只負責勾選 / 取消勾選,沒有數量輸入                       */
/* =============================================================== */

function BrowseRow({
  node,
  byParent,
  collapsed,
  visibleIds,
  renderableIds,
  forceExpand,
  onToggleExpand,
  valueMap,
  onToggle,
}: {
  node: PickerItem;
  byParent: Map<string | null, PickerItem[]>;
  collapsed: Set<string>;
  visibleIds: Set<string> | null;
  renderableIds: Set<string>;
  forceExpand: boolean;
  onToggleExpand: (id: string) => void;
  valueMap: Map<string, PickerValue>;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const children = (byParent.get(node.id) ?? []).filter(
    (child) =>
      renderableIds.has(child.id) &&
      (!visibleIds || visibleIds.has(child.id)),
  );
  const hasChildren = children.length > 0;
  // collapsed set 模式:預設展開,只有被使用者主動折疊的才在 set 裡。
  const isOpen = forceExpand || !collapsed.has(node.id);
  const isSection = node.itemType === "section";

  const checked = valueMap.has(node.id);
  // 該節含有幾個被選的後代工項(只在 section 顯示「已選 N」標籤,跟手機版同邏輯)
  const selectedDescendantCount = isSection
    ? countSelectedDescendants(byParent, node.id, valueMap)
    : 0;

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
        {isSection && selectedDescendantCount > 0 && (
          <span className="shrink-0 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-xs font-medium text-[#4A7C59]">
            已選 {selectedDescendantCount}
          </span>
        )}
      </div>

      {hasChildren && isOpen
        ? children.map((c) => (
            <BrowseRow
              key={c.id}
              node={c}
              byParent={byParent}
              collapsed={collapsed}
              visibleIds={visibleIds}
              renderableIds={renderableIds}
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
  renderableIds,
}: {
  items: PickerItem[];
  byParent: Map<string | null, PickerItem[]>;
  valueMap: Map<string, PickerValue>;
  onToggle: (id: string, checked: boolean) => void;
  query: string;
  renderableIds: Set<string>;
}) {
  const [path, setPath] = useState<PickerItem[]>([]);

  // 搜尋中:忽略 path,顯示扁平結果(只可勾選的 item / spec / manual,且已完成的不顯示)
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    const matches = items.filter((it) => {
      if (it.itemType === "section") return false;
      if (!renderableIds.has(it.id)) return false;
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

  // Path collapse:單一 section 子節點的層級自動跳過,使用者少按好幾下。
  // path = 使用者實際點過的;skippedSuffix = 自動跳進去的中介層;
  // effectivePath = 兩者合併,只用於顯示與計算 currentChildren。
  const userParentId = path.length === 0 ? null : path[path.length - 1].id;
  const skippedSuffix = collapseSinglePathSections(userParentId, byParent);
  const effectivePath = [...path, ...skippedSuffix];
  const currentParentId =
    effectivePath.length === 0
      ? null
      : effectivePath[effectivePath.length - 1].id;
  // 已完成的工項(以及只剩已完成工項的 section)在這一層也不顯示
  const currentChildren = (byParent.get(currentParentId) ?? []).filter((c) =>
    renderableIds.has(c.id),
  );

  return (
    <div>
      {effectivePath.length > 0 && (
        <div className="border-b border-[#E0DCD6] bg-[#FAF7F2] px-3 py-2.5">
          {path.length > 0 && (
            <button
              type="button"
              onClick={() => setPath((p) => p.slice(0, -1))}
              className="inline-flex min-h-[36px] items-center gap-1.5 text-sm font-medium text-accent active:opacity-70"
            >
              <ChevronLeft className="size-4" /> 上一層
            </button>
          )}
          <div className="mt-1 break-words text-sm text-muted-foreground">
            {effectivePath.map((p) => p.name).join(" › ")}
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

/**
 * 工項是否已完成(歷史累計達 100% 或標單量) — 完成的就不再讓使用者勾選。
 *   - percent 模式:total >= 1
 *   - absolute 模式:有 totalQuantity 才能判斷,total >= totalQuantity 視為完成
 *   - 沒 aggregate(從沒填過):一定不算完成
 */
function isWorkItemCompleted(
  item: PickerItem,
  agg: WorkItemAggregate | undefined,
): boolean {
  if (!agg) return false;
  if (agg.mode === "percent") return agg.total >= 1;
  if (agg.mode === "absolute" && item.totalQuantity != null) {
    return agg.total >= item.totalQuantity;
  }
  return false;
}

/**
 * 單一通道層級自動跳過:若某層只有一個 section 子節點(沒有可勾的工項),
 * 那層只是中介資料夾,直接跳進該子節點繼續判斷,直到遇到分岔或可勾項目。
 */
function collapseSinglePathSections(
  parentId: string | null,
  byParent: Map<string | null, PickerItem[]>
): PickerItem[] {
  const children = byParent.get(parentId) ?? [];
  if (children.length === 1 && children[0].itemType === "section") {
    return [
      children[0],
      ...collapseSinglePathSections(children[0].id, byParent),
    ];
  }
  return [];
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

