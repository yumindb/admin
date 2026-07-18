"use client";

import { useState } from "react";
import { PhotoLightbox } from "@/components/photo-lightbox";

export type GalleryPhoto = {
  path: string;
  caption?: string | null;
};

/**
 * 照片清單 + lightbox。給日誌詳情、現場回報詳情用。
 *
 * 兩種版型:
 *   - "grid"  方格 + caption 在下(原本日誌詳情用)
 *   - "row"   一張一列 + caption 在右(原本現場回報詳情用)
 *
 * 點任何一張照片都會開 lightbox(共用 photos 清單),可上下張切換。
 */
/** 首批 render 的張數 — 案件頁全案照片可能好幾百張,一次全 render
 *  = 幾百個同時請求 + 手機記憶體爆炸;先出 24 張,要看更多再按。 */
const INITIAL_BATCH = 24;
const BATCH_SIZE = 48;

export function PhotoGallery({
  photos,
  layout = "grid",
  initialCount = INITIAL_BATCH,
}: {
  photos: GalleryPhoto[];
  layout?: "grid" | "row";
  /** 首批張數 — 簽核頁傳 Infinity(核定人必須一眼看到全部照片,不能被
   *  「顯示更多」藏住);案件頁全案照片用預設分批 */
  initialCount?: number;
}) {
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(initialCount);
  const visible = photos.slice(0, visibleCount);
  const hasMore = photos.length > visibleCount;

  // lightbox 拿完整清單:已顯示的縮圖點進去仍可一路滑到底
  const lightbox = (
    <PhotoLightbox
      photos={photos}
      path={lightboxPath}
      onChange={setLightboxPath}
    />
  );

  const loadMore = hasMore && (
    <button
      type="button"
      onClick={() => setVisibleCount((n) => n + BATCH_SIZE)}
      className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-[#E0DCD6] bg-card text-sm text-foreground transition-colors hover:border-accent"
    >
      顯示更多照片（還有 {photos.length - visibleCount} 張）
    </button>
  );

  if (layout === "row") {
    return (
      <>
        <ul className="space-y-3">
          {visible.map((p, idx) => (
            <li
              key={p.path + idx}
              className="grid grid-cols-[8rem_1fr] items-start gap-3 rounded-md border border-[#E0DCD6] bg-card p-3"
            >
              <button
                type="button"
                onClick={() => setLightboxPath(p.path)}
                className="block aspect-square cursor-zoom-in overflow-hidden rounded-md border border-[#E0DCD6] bg-[#F5F1EC]"
                aria-label="放大檢視"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.path}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
              <p className="whitespace-pre-line text-sm">
                {p.caption || (
                  <span className="text-muted-foreground">（未附說明）</span>
                )}
              </p>
            </li>
          ))}
        </ul>
        {loadMore}
        {lightbox}
      </>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {visible.map((p, i) => (
          <figure
            key={`${p.path}-${i}`}
            className="overflow-hidden rounded-md border border-[#E0DCD6] bg-white"
          >
            <button
              type="button"
              onClick={() => setLightboxPath(p.path)}
              className="block w-full cursor-zoom-in"
              aria-label="放大檢視"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.path}
                alt={p.caption || ""}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            </button>
            {p.caption && (
              <figcaption className="border-t border-[#F0EBE4] bg-[#FAF7F2] px-2 py-1.5 text-xs text-foreground">
                {p.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {loadMore}
      {lightbox}
    </>
  );
}
