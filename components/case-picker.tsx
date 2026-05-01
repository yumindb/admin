"use client";

import { useEffect, useState } from "react";

export type CasePickerOption = {
  id: string;
  name: string;
  code: string | null;
};

/**
 * 大按鈕 + 全螢幕清單的案場選擇器。
 * 給現場工人用 — 點一下展開大字大按鈕的案場清單,點一下就選好。
 */
export function CasePicker({
  cases,
  value,
  onChange,
  emptyText = "沒有可用案場",
}: {
  cases: CasePickerOption[];
  value: string;
  onChange: (id: string) => void;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = cases.find((c) => c.id === value);

  // ESC / 點背景關閉 + 鎖捲動
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border-2 border-[#E0DCD6] bg-white px-5 py-5 text-left transition-colors hover:border-[#A07850]/60 active:bg-[#FAF7F2]"
      >
        <div className="min-w-0 flex-1">
          {selected ? (
            <>
              <div className="text-sm text-muted-foreground">
                {selected.code ?? "未編號"}
              </div>
              <div className="mt-0.5 text-xl font-semibold text-primary">
                {selected.name}
              </div>
            </>
          ) : (
            <div className="text-xl font-medium text-muted-foreground">
              👉 點這裡選案場
            </div>
          )}
        </div>
        <span className="shrink-0 text-2xl text-[#A07850]" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="選擇案場"
          className="fixed inset-0 z-50 flex flex-col bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="mt-auto max-h-[85vh] overflow-y-auto rounded-t-2xl bg-card shadow-xl md:m-auto md:max-h-[80vh] md:max-w-lg md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-[#E0DCD6] bg-card px-5 py-4">
              <h3 className="text-xl font-semibold text-primary">選案場</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex size-12 items-center justify-center rounded-full text-2xl text-muted-foreground hover:bg-[#F5F1EC]"
                aria-label="關閉"
              >
                ×
              </button>
            </div>
            {cases.length === 0 ? (
              <p className="px-5 py-12 text-center text-base text-muted-foreground">
                {emptyText}
              </p>
            ) : (
              <ul>
                {cases.map((c, idx) => {
                  const isSelected = c.id === value;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(c.id);
                          setOpen(false);
                        }}
                        className={`flex w-full items-start gap-3 px-5 py-5 text-left transition-colors ${
                          idx > 0 ? "border-t border-[#F0EBE4]" : ""
                        } ${
                          isSelected
                            ? "bg-[#FAF7F2]"
                            : "hover:bg-[#F5F1EC] active:bg-[#F0EBE4]"
                        }`}
                      >
                        <span
                          className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
                            isSelected
                              ? "border-accent bg-accent text-white"
                              : "border-[#E0DCD6] bg-white"
                          }`}
                          aria-hidden
                        >
                          {isSelected ? "✓" : ""}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-muted-foreground">
                            {c.code ?? "未編號"}
                          </span>
                          <span className="mt-0.5 block text-lg font-semibold text-primary">
                            {c.name}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
