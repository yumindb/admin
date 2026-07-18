"use client";

import { useMemo } from "react";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import "yet-another-react-lightbox/plugins/counter.css";

export type LightboxPhoto = {
  path: string;
  caption?: string | null;
};

/**
 * 全螢幕照片放大檢視。基於 yet-another-react-lightbox:
 * 跟手滑動翻頁(含慣性/邊界回彈)、雙指縮放、雙擊放大、下拉關閉、
 * ←→ 鍵切換、ESC / 點背景關閉、背景捲動鎖定。照片下方顯示 caption。
 * 沒有左右箭頭按鈕 — 手機滑動、桌機用鍵盤(2026-07 依 Phil 手機使用回饋簡化)。
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
  const slides = useMemo(
    () =>
      items.map((p) => ({
        src: p.path,
        alt: p.caption ?? "",
        description: p.caption || undefined,
      })),
    [items],
  );
  const idx = path ? paths.indexOf(path) : -1;

  return (
    <Lightbox
      open={idx >= 0}
      close={() => onChange(null)}
      index={idx >= 0 ? idx : 0}
      slides={slides}
      on={{
        // controlled mode:翻頁時把目前照片回寫給呼叫端
        view: ({ index }) => {
          if (paths[index] && paths[index] !== path) onChange(paths[index]);
        },
      }}
      plugins={[Captions, Counter, Zoom]}
      carousel={{ finite: true, preload: 2, imageFit: "contain" }}
      controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
      // 不要左右箭頭按鈕:手機直接滑,桌機用 ←→ 鍵
      render={{ buttonPrev: () => null, buttonNext: () => null }}
      captions={{ descriptionTextAlign: "start", descriptionMaxLines: 8 }}
      zoom={{ maxZoomPixelRatio: 3 }}
      // 計數移到右下,避開下方 caption;字級照手機優先原則放大(見 globals.css 的 yarl 區塊)
      counter={{
        container: {
          style: { top: "unset", bottom: 0, left: "unset", right: 0 },
        },
      }}
    />
  );
}
