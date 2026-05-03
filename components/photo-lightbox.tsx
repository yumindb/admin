"use client";

import { useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type LightboxPhoto = {
  path: string;
  caption?: string | null;
};

/**
 * 全螢幕照片放大檢視 + 上下張切換 + 照片下方顯示 caption。
 *
 * 點背景或 × 關閉、點圖本身不關。←→ 鍵或左右箭頭按鈕在 photos 中切換。ESC 關閉。
 *
 * 用法:
 *   const [path, setPath] = useState<string | null>(null);
 *   ...
 *   <PhotoLightbox
 *     photos={photos}            // [{ path, caption? }]
 *     path={path}
 *     onChange={setPath}
 *   />
 *
 * 為了相容舊呼叫(只傳 path 字串陣列),photos 也接 string[]。
 */
export function PhotoLightbox({
  photos,
  path,
  onChange,
}: {
  photos: LightboxPhoto[] | string[];
  path: string | null;
  onChange: (next: string | null) => void;
}) {
  const items = useMemo<LightboxPhoto[]>(
    () =>
      photos.map((p) => (typeof p === "string" ? { path: p, caption: null } : p)),
    [photos],
  );
  const paths = useMemo(() => items.map((p) => p.path), [items]);
  const idx = path ? paths.indexOf(path) : -1;
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < paths.length - 1;
  const caption = idx >= 0 ? items[idx]?.caption ?? null : null;

  // 鍵盤:ESC 關閉、←→ 切換
  useEffect(() => {
    if (!path) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onChange(null);
      } else if (e.key === "ArrowLeft" && hasPrev) {
        onChange(paths[idx - 1]);
      } else if (e.key === "ArrowRight" && hasNext) {
        onChange(paths[idx + 1]);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [path, idx, hasPrev, hasNext, paths, onChange]);

  if (!path) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => onChange(null)}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/85 p-4"
    >
      <div
        className="flex w-full flex-1 items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={path}
          alt={caption ?? ""}
          className="max-h-full max-w-full object-contain"
        />
      </div>

      {/* 照片說明 — 圖下方,點不會關閉。空字串 / null 不渲染。 */}
      {caption && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-3 max-h-[28vh] w-full max-w-3xl overflow-y-auto rounded-md bg-black/60 px-4 py-2.5 text-center text-sm leading-relaxed text-white whitespace-pre-line"
        >
          {caption}
        </div>
      )}

      {/* 上下張箭頭 — 只在有多張照片且不在邊界時顯示 */}
      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(paths[idx - 1]);
          }}
          aria-label="上一張"
          className="absolute left-2 top-1/2 -translate-y-1/2 inline-flex size-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg hover:bg-white md:left-4"
        >
          <ChevronLeft className="size-6" />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(paths[idx + 1]);
          }}
          aria-label="下一張"
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex size-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg hover:bg-white md:right-4"
        >
          <ChevronRight className="size-6" />
        </button>
      )}

      {/* 計數 X / N — 多於 1 張才顯示。位置改到右下,避開下方 caption */}
      {paths.length > 1 && idx >= 0 && (
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
          {idx + 1} / {paths.length}
        </div>
      )}

      {/* 關閉 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange(null);
        }}
        aria-label="關閉"
        className="absolute right-2 top-2 inline-flex size-12 items-center justify-center rounded-full bg-white/90 text-2xl text-black shadow-lg hover:bg-white md:right-4 md:top-4"
      >
        ×
      </button>
    </div>
  );
}
