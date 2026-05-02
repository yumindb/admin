"use client";

/**
 * 工項新增 / 編輯共用 modal — 由 WorkItemsTreeSection 控制開關。
 *
 *  - mode = "create" → 顯示「上層分類」dropdown,送 createWorkItemAction
 *  - mode = "edit"   → 預填現值,送 updateWorkItemAction (name/unit/qty/unit_price/brand_note)
 *  - 不允許切 item_type 也不允許改 parent_id (避免樹結構亂)
 *  - 不允許編輯 section (UI 不會給 section 一個編輯按鈕,server 也擋)
 */

import { useEffect, useState, useTransition } from "react";
import { X } from "lucide-react";
import {
  createWorkItemAction,
  updateWorkItemAction,
  type WorkItemActionResult,
} from "@/app/(app)/cases/[id]/work-items-actions";

export type SectionOption = {
  id: string;
  label: string; // e.g. "壹  土木工程" (depth 縮排前綴由父層處理)
  depth: number;
};

export type WorkItemEditTarget = {
  id: string;
  name: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  brandNote: string | null;
  itemType: "section" | "item" | "spec" | "manual";
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (result: WorkItemActionResult) => void;
  caseId: string;
  /** 可選的 parent (section / item) 列表 — create 時用 dropdown */
  sectionOptions: SectionOption[];
  mode: "create" | "edit";
  /** create 時:預設 parent_id (例如從某個 section 旁的 + 按鈕觸發) */
  initialParentId?: string | null;
  /** edit 時:現有工項資料 */
  target?: WorkItemEditTarget;
};

export function WorkItemEditModal({
  open,
  onClose,
  onSaved,
  caseId,
  sectionOptions,
  mode,
  initialParentId,
  target,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [parentId, setParentId] = useState<string>("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [brandNote, setBrandNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    if (mode === "edit" && target) {
      setName(target.name);
      setUnit(target.unit ?? "");
      setQuantity(target.quantity != null ? String(target.quantity) : "");
      setUnitPrice(target.unitPrice != null ? String(target.unitPrice) : "");
      setBrandNote(target.brandNote ?? "");
    } else {
      setName("");
      setUnit("");
      setQuantity("");
      setUnitPrice("");
      setBrandNote("");
      setParentId(initialParentId ?? "");
    }
  }, [open, mode, target, initialParentId]);

  // ESC 關閉
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function submit() {
    setErrorMsg(null);
    const fd = new FormData();
    if (mode === "create") {
      fd.set("case_id", caseId);
      if (parentId) fd.set("parent_id", parentId);
      fd.set("name", name);
      fd.set("unit", unit);
      fd.set("quantity", quantity);
      fd.set("unit_price", unitPrice);
      fd.set("brand_note", brandNote);
    } else if (target) {
      fd.set("work_item_id", target.id);
      fd.set("name", name);
      fd.set("unit", unit);
      fd.set("quantity", quantity);
      fd.set("unit_price", unitPrice);
      fd.set("brand_note", brandNote);
    }

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createWorkItemAction(fd)
          : await updateWorkItemAction(fd);
      if (!result.ok) {
        setErrorMsg(result.error);
        return;
      }
      onSaved(result);
      onClose();
    });
  }

  const title = mode === "create" ? "新增工項" : "編輯工項";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-item-modal-title"
    >
      <div className="w-full max-w-lg rounded-lg border border-[#E0DCD6] bg-card">
        <div className="flex items-center justify-between border-b border-[#E0DCD6] px-5 py-3">
          <h2
            id="work-item-modal-title"
            className="text-base font-semibold text-primary"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="關閉"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {mode === "create" && (
            <Field label="上層分類">
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
              >
                <option value="">（不指定 — 放在最上層）</option>
                {sectionOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {"  ".repeat(opt.depth)}
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="名稱" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="單位">
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="M / 式 / 組"
                className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
              />
            </Field>
            <Field label="契約數量">
              <input
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
              />
            </Field>
          </div>

          <Field label="單價">
            <input
              type="number"
              step="any"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </Field>

          <Field label="廠牌／備註">
            <input
              type="text"
              value={brandNote}
              onChange={(e) => setBrandNote(e.target.value)}
              className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </Field>

          {mode === "edit" && target?.itemType !== "manual" && (
            <p className="rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-3 py-2 text-xs text-muted-foreground">
              編輯後此工項將標記為「已修改」,下次匯入時不會被覆蓋。
            </p>
          )}

          {errorMsg && (
            <p className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
              {errorMsg}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E0DCD6] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="inline-flex items-center rounded-md border border-[#E0DCD6] bg-white px-3 py-1.5 text-sm text-foreground transition-colors hover:border-accent disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !name.trim()}
            className="inline-flex items-center rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-[#B91C1C]">*</span>}
      </span>
      {children}
    </label>
  );
}
