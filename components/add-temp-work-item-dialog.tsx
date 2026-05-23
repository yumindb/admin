"use client";

/**
 * 「+ 新增臨時項」dialog — 工地主任填日誌時即時新增 合約外/未簽約 工項。
 *
 * 流程:
 *   1. 點開 dialog → 輸入名稱、單位、數量、(選填)單價、備註
 *   2. submit → createExtraOrUnsignedAction → server insert case_work_items 一筆
 *   3. server 回傳 workItemId → onCreated 回調,呼叫端把它接到 picker items + 自動勾選
 *
 * 沿用 work-item-edit-modal 的視覺,但更精簡(沒有「上層分類」,沒有 modified_by_user 提示)。
 */

import { useEffect, useState, useTransition } from "react";
import { X } from "lucide-react";
import { createExtraOrUnsignedAction } from "@/app/(app)/cases/[id]/work-items-actions";

export type AddTempCreated = {
  id: string;
  name: string;
  unit: string | null;
  quantity: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  caseId: string;
  kind: "extra" | "unsigned";
  onCreated: (item: AddTempCreated) => void;
};

export function AddTempWorkItemDialog({
  open,
  onClose,
  caseId,
  kind,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [brandNote, setBrandNote] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!open) return;
    // 開啟時重設表單(常見的 dialog 重設 pattern)
    setName("");
    setUnit("");
    setQuantity("");
    setUnitPrice("");
    setBrandNote("");
    setErrorMsg(null);
  }, [open]);

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
    if (!name.trim()) {
      setErrorMsg("名稱必填");
      return;
    }
    setErrorMsg(null);
    const fd = new FormData();
    fd.set("case_id", caseId);
    fd.set("kind", kind);
    fd.set("name", name.trim());
    fd.set("unit", unit);
    fd.set("quantity", quantity);
    fd.set("unit_price", unitPrice);
    fd.set("brand_note", brandNote);

    startTransition(async () => {
      const r = await createExtraOrUnsignedAction(fd);
      if (!r.ok) {
        setErrorMsg(r.error);
        return;
      }
      onCreated({
        id: r.workItemId,
        name: name.trim(),
        unit: unit.trim() || null,
        quantity:
          quantity.trim() && Number.isFinite(Number(quantity))
            ? Number(quantity)
            : null,
      });
      onClose();
    });
  }

  const title = kind === "extra" ? "新增合約外項目" : "新增未簽約項目";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-[#E0DCD6] bg-card">
        <div className="flex items-center justify-between border-b border-[#E0DCD6] px-5 py-3">
          <h3 className="text-base font-semibold text-primary">{title}</h3>
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
          {/* 主角:名稱欄 + 大送出鈕。屋主臨時加項,現場 supervisor 直接打名字就好。 */}
          <div>
            <p className="mb-2 text-sm font-medium text-primary">
              屋主臨時加項?直接打名字就好,其他現場不用管。
            </p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="例:配電盤升級"
              className="h-12 w-full rounded-md border-2 border-[#A07850]/40 bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </div>

          {/* 配角:其他選填欄位包進 details 摺疊起來,降低視覺壓力 */}
          <details className="rounded-md border border-dashed border-[#E0DCD6] bg-[#FAF7F2]/40">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1">
                <span aria-hidden>＋</span>
                更多選項(單位 / 數量 / 單價 / 備註,辦公室之後可補)
              </span>
            </summary>
            <div className="space-y-2.5 border-t border-dashed border-[#E0DCD6] px-3 py-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="單位">
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="式 / 組 / ㎡"
                    className="h-9 w-full rounded-md border border-[#E0DCD6] bg-white px-2 text-sm outline-none focus-visible:border-accent"
                  />
                </Field>
                <Field label="預計總量">
                  <input
                    type="number"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="例:1"
                    className="h-9 w-full rounded-md border border-[#E0DCD6] bg-white px-2 text-sm outline-none focus-visible:border-accent"
                  />
                </Field>
              </div>
              <Field label="單價">
                <input
                  type="number"
                  step="any"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className="h-9 w-full rounded-md border border-[#E0DCD6] bg-white px-2 text-sm outline-none focus-visible:border-accent"
                />
              </Field>
              <Field label="備註">
                <input
                  type="text"
                  value={brandNote}
                  onChange={(e) => setBrandNote(e.target.value)}
                  placeholder="例:屋主臨時要求 / 等業主決定材質"
                  className="h-9 w-full rounded-md border border-[#E0DCD6] bg-white px-2 text-sm outline-none focus-visible:border-accent"
                />
              </Field>
            </div>
          </details>

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
            className="inline-flex items-center rounded-md border border-[#E0DCD6] bg-white px-3 py-1.5 text-sm transition-colors hover:border-accent disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !name.trim()}
            className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "新增中…" : "新增並打勾"}
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
