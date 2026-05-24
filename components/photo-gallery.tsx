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
export function PhotoGallery({
  photos,
  layout = "grid",
}: {
  photos: GalleryPhoto[];
  layout?: "grid" | "row";
}) {
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);

  const lightbox = (
    <PhotoLightbox
      photos={photos}
      path={lightboxPath}
      onChange={setLightboxPath}
    />
  );

  if (layout === "row") {
    return (
      <>
        <ul className="space-y-3">
          {photos.map((p, idx) => (
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
        {lightbox}
      </>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {photos.map((p, i) => (
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
      {lightbox}
    </>
  );
}
