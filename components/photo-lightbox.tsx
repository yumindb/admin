"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * 全螢幕照片放大檢視 + 上下張切換。
 *
 * 點背景或 × 關閉、點圖本身不關。←→ 鍵或左右箭頭按鈕在 photos 中切換。ESC 關閉。
 *
 * 用法:
 *   const [path, setPath] = useState<string | null>(null);
 *   ...
 *   <PhotoLightbox
 *     photos={photos.map((p) => p.path)}
 *     path={path}
 *     onChange={setPath}
 *   />
 */
export function PhotoLightbox({
  photos,
  path,
  onChange,
}: {
  photos: string[];
  path: string | null;
  onChange: (next: string | null) => void;
}) {
  const idx = path ? photos.indexOf(path) : -1;
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < photos.length - 1;

  // 鍵盤:ESC 關閉、←→ 切換
  useEffect(() => {
    if (!path) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onChange(null);
      } else if (e.key === "ArrowLeft" && hasPrev) {
        onChange(photos[idx - 1]);
      } else if (e.key === "ArrowRight" && hasNext) {
        onChange(photos[idx + 1]);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [path, idx, hasPrev, hasNext, photos, onChange]);

  if (!path) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => onChange(null)}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={path}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full object-contain"
      />

      {/* 上下張箭頭 — 只在有多張照片且不在邊界時顯示 */}
      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(photos[idx - 1]);
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
            onChange(photos[idx + 1]);
          }}
          aria-label="下一張"
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex size-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg hover:bg-white md:right-4"
        >
          <ChevronRight className="size-6" />
        </button>
      )}

      {/* 計數 X / N — 多於 1 張才顯示 */}
      {photos.length > 1 && idx >= 0 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
          {idx + 1} / {photos.length}
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
