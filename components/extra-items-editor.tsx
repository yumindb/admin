"use client";

import { Trash2 } from "lucide-react";

/**
 * 重複輸入列編輯器 — 給「合約外項目」、「未簽約項目」用。
 * 每個 column 是獨立 input,row 末尾有刪除按鈕。
 */

export type ColumnDef<T> = {
  key: keyof T & string;
  label: string;
  type?: "text" | "number" | "select";
  options?: string[];           // for select
  inputMode?: "decimal" | "numeric" | "text";
  placeholder?: string;
  width?: string;               // CSS class for width
  required?: boolean;
};

type Props<T extends Record<string, unknown>> = {
  rows: T[];
  columns: ColumnDef<T>[];
  onChange: (rows: T[]) => void;
  empty: T;                     // template for new row
  addLabel?: string;
  emptyHint?: string;
};

export function ExtraItemsEditor<T extends Record<string, unknown>>({
  rows,
  columns,
  onChange,
  empty,
  addLabel = "+ 新增一列",
  emptyHint = "尚未新增任何項目",
}: Props<T>) {
  function patch(idx: number, patch: Partial<T>) {
    const next = [...rows];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }

  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }

  function add() {
    onChange([...rows, { ...empty }]);
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className="rounded-md border border-[#E0DCD6] bg-card p-3"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {columns.map((col) => (
                  <div key={col.key} className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {col.label}
                      {col.required && (
                        <span className="ml-0.5 text-[#B91C1C]">*</span>
                      )}
                    </label>
                    {col.type === "select" ? (
                      <select
                        value={String(row[col.key] ?? "")}
                        onChange={(e) =>
                          patch(idx, { [col.key]: e.target.value || undefined } as Partial<T>)
                        }
                        className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
                      >
                        <option value="">—</option>
                        {col.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : col.type === "number" ? (
                      <input
                        type="number"
                        inputMode={col.inputMode ?? "decimal"}
                        min={0}
                        step="any"
                        value={String(row[col.key] ?? "")}
                        onChange={(e) => {
                          const v = e.target.value;
                          patch(idx, {
                            [col.key]:
                              v === ""
                                ? undefined
                                : Number(v),
                          } as Partial<T>);
                        }}
                        placeholder={col.placeholder}
                        className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-2 text-sm tabular-nums outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
                      />
                    ) : (
                      <input
                        type="text"
                        value={String(row[col.key] ?? "")}
                        onChange={(e) =>
                          patch(idx, {
                            [col.key]: e.target.value || undefined,
                          } as Partial<T>)
                        }
                        placeholder={col.placeholder}
                        className="h-10 w-full rounded-md border border-[#E0DCD6] bg-white px-2 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#E0DCD6] bg-white px-3 py-1.5 text-xs text-[#B91C1C] transition-colors hover:bg-[#FEF2F2]"
                >
                  <Trash2 className="size-3.5" />
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={add}
        className="w-full min-h-[44px] rounded-md border border-dashed border-[#E0DCD6] bg-white text-sm text-muted-foreground transition-colors hover:border-accent hover:text-accent"
      >
        {addLabel}
      </button>
    </div>
  );
}
