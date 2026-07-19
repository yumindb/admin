"use client";

import { useMemo, useState } from "react";
import { useSilentLocationOnce } from "@/lib/use-geolocation";
import { ModalShell } from "@/components/ui/modal-shell";
import { formatDistance, haversineMeters } from "@/lib/geo";

export type CasePickerOption = {
  id: string;
  name: string;
  code: string | null;
  // migration-2.20:可選座標。提供時 picker 依距離排序 + 顯示「離我多遠」
  lat?: number | null;
  lng?: number | null;
  // 可選 geofence 半徑 — 回報表單用來「人在範圍內就自動選好案場」;picker 本身不用
  geofence_radius_m?: number | null;
};

/**
 * Picker 第一段「特殊選項」— 例如打卡頁的「在公司 / 移動中」。
 * 不參與距離排序,固定在最上面。
 */
export type CasePickerExtraOption = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
};

/**
 * 大按鈕 + 全螢幕清單的案場選擇器。
 * 給現場工人用 — 點一下展開大字大按鈕的案場清單,點一下就選好。
 *
 * 若 cases 帶有 lat/lng + 使用者已授權定位,自動依距離由近到遠排序,
 * 並在每個 option 顯示距離(例:「245 m」)。
 */
export function CasePicker({
  cases,
  value,
  onChange,
  emptyText = "沒有可用案場",
  sortByDistance = true,
  extraOptions,
  placeholder = "👉 點這裡選案場",
}: {
  cases: CasePickerOption[];
  value: string;
  onChange: (id: string) => void;
  emptyText?: string;
  sortByDistance?: boolean;
  extraOptions?: CasePickerExtraOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = cases.find((c) => c.id === value);
  const selectedExtra = extraOptions?.find((e) => e.id === value);

  // 靜默取位置(已授權才取;沒授權就 fallback 用原順序)
  const myLoc = useSilentLocationOnce();

  const orderedCases = useMemo(() => {
    if (!sortByDistance || !myLoc) return cases;
    const me = { lat: myLoc.lat, lng: myLoc.lng };
    return [...cases].sort((a, b) => {
      const da =
        a.lat != null && a.lng != null
          ? haversineMeters(me, { lat: a.lat, lng: a.lng })
          : Infinity;
      const db =
        b.lat != null && b.lng != null
          ? haversineMeters(me, { lat: b.lat, lng: b.lng })
          : Infinity;
      return da - db;
    });
  }, [cases, myLoc, sortByDistance]);

  const distanceLabelOf = (c: CasePickerOption): string | null => {
    if (!myLoc || c.lat == null || c.lng == null) return null;
    const d = haversineMeters({ lat: myLoc.lat, lng: myLoc.lng }, { lat: c.lat, lng: c.lng });
    return formatDistance(d);
  };

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
          ) : selectedExtra ? (
            <div className="text-xl font-semibold text-primary">
              {selectedExtra.icon ? `${selectedExtra.icon} ` : ""}
              {selectedExtra.label}
              {selectedExtra.description && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {selectedExtra.description}
                </span>
              )}
            </div>
          ) : (
            <div className="text-xl font-medium text-muted-foreground">
              {placeholder}
            </div>
          )}
        </div>
        <span className="shrink-0 text-2xl text-[#A07850]" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        // 整片 panel 就是捲動容器(sticky 標題列貼在頂端)
        <ModalShell
          variant="sheet"
          onClose={() => setOpen(false)}
          ariaLabel="選擇案場"
          panelClassName="md:max-w-lg overflow-y-auto overscroll-contain"
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
          {extraOptions && extraOptions.length > 0 && (
            <ul className="border-b border-[#E0DCD6]">
              {extraOptions.map((ex) => {
                const isSel = ex.id === value;
                return (
                  <li key={ex.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(ex.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-start gap-3 px-5 py-5 text-left transition-colors ${
                        isSel
                          ? "bg-[#FAF7F2]"
                          : "hover:bg-[#F5F1EC] active:bg-[#F0EBE4]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
                          isSel
                            ? "border-accent bg-accent text-white"
                            : "border-[#E0DCD6] bg-white"
                        }`}
                        aria-hidden
                      >
                        {isSel ? "✓" : ""}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-lg font-semibold text-primary">
                          {ex.icon ? `${ex.icon} ` : ""}
                          {ex.label}
                        </span>
                        {ex.description && (
                          <span className="mt-0.5 block text-sm text-muted-foreground">
                            {ex.description}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {cases.length === 0 ? (
            <p className="px-5 py-12 text-center text-base text-muted-foreground">
              {emptyText}
            </p>
          ) : (
            <>
              {myLoc && sortByDistance && (
                <p className="px-5 pt-3 text-xs text-muted-foreground">
                  已依離你最近排序
                </p>
              )}
              <ul>
                {orderedCases.map((c, idx) => {
                  const isSelected = c.id === value;
                  const dist = distanceLabelOf(c);
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
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-sm text-muted-foreground">
                              {c.code ?? "未編號"}
                            </span>
                            {dist && (
                              <span className="rounded-md bg-[#F5F1EC] px-1.5 py-0.5 font-mono text-xs tabular-nums text-foreground">
                                {dist}
                              </span>
                            )}
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
            </>
          )}
        </ModalShell>
      )}
    </>
  );
}
