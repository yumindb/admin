"use client";

import { useEffect, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type LightboxPhoto = {
  path: string;
  caption?: string | null;
};

type Drag = {
  startX: number;
  startY: number;
  axis: "x" | "y" | null; // 手勢一開始的主要方向,鎖定後不再改變
  raw: number; // 未阻尼的水平位移,用來判斷是否翻頁
  lastX: number;
  lastT: number;
  vx: number; // px/ms,判斷快速輕滑
};

/**
 * 全螢幕照片放大檢視 + 上下張切換 + 照片下方顯示 caption。
 *
 * 點背景或 × 關閉、點圖本身不關。←→ 鍵或左右箭頭按鈕切換。手機上照片跟著
 * 手指滑動,放開後依距離與速度決定翻頁或彈回;第一張/最後一張再往外拉有阻尼。
 * 開啟時鎖定背景頁面捲動。ESC 關閉。
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
  const open = path !== null;

  // 三格滑軌:prev / current / next 並排,平時停在中間格。
  // 位移用 ref + 直接改 style,touchmove 高頻更新不經過 re-render 才會順。
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const cancelSettleRef = useRef<(() => void) | null>(null);

  function setTrack(dx: number, animate: boolean) {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.22s ease-out" : "none";
    el.style.transform = `translateX(calc(-33.3333% + ${dx}px))`;
  }

  // 放開手指後收尾:翻到上/下張(動畫跑完才真正換 state),或彈回原位
  function settle(dir: "prev" | "next" | "stay") {
    const el = trackRef.current;
    if (!el) return;
    if (dir === "stay") {
      setTrack(0, true);
      return;
    }
    const nextPath = dir === "prev" ? paths[idx - 1] : paths[idx + 1];
    const w = el.clientWidth / 3;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      cancelSettleRef.current = null;
      // 同步 flush:換完照片立刻把滑軌歸位,避免中間閃一格
      flushSync(() => onChange(nextPath));
      setTrack(0, false);
    };
    const onEnd = (ev: TransitionEvent) => {
      if (ev.target === el && ev.propertyName === "transform") finish();
    };
    // transitionend 偶爾不觸發(分頁切換、動畫被中斷),用 timer 保底
    const timer = setTimeout(finish, 300);
    cancelSettleRef.current = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      cancelSettleRef.current = null;
    };
    el.addEventListener("transitionend", onEnd);
    setTrack(dir === "prev" ? w : -w, true);
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) {
      // 第二指落下(縮放手勢)就放棄這次滑動
      dragRef.current = null;
      setTrack(0, true);
      return;
    }
    cancelSettleRef.current?.();
    const t = e.touches[0];
    dragRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      axis: null,
      raw: 0,
      lastX: t.clientX,
      lastT: e.timeStamp,
      vx: 0,
    };
  }

  function onTouchMove(e: React.TouchEvent) {
    const d = dragRef.current;
    if (!d || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - d.startX;
    const dy = t.clientY - d.startY;
    if (!d.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (d.axis !== "x") return;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.vx = (t.clientX - d.lastX) / dt;
    d.lastX = t.clientX;
    d.lastT = e.timeStamp;
    d.raw = dx;
    // 邊界外拉加阻尼,提示已經沒有下一張
    const resisted =
      (dx > 0 && !hasPrev) || (dx < 0 && !hasNext) ? dx * 0.25 : dx;
    setTrack(resisted, false);
  }

  function onTouchEnd(e: React.TouchEvent) {
    const d = dragRef.current;
    if (e.touches.length > 0) return; // 還有手指在螢幕上
    dragRef.current = null;
    if (!d || d.axis !== "x") return;
    const el = trackRef.current;
    const w = el ? el.clientWidth / 3 : 0;
    // 拉超過 1/4 寬,或快速輕滑(方向一致)就翻頁
    const flick = Math.abs(d.raw) > 30 && Math.abs(d.vx) > 0.45 && d.vx * d.raw > 0;
    const commit = w > 0 && (Math.abs(d.raw) > w / 4 || flick);
    if (commit && d.raw > 0 && hasPrev) settle("prev");
    else if (commit && d.raw < 0 && hasNext) settle("next");
    else settle("stay");
  }

  function onTouchCancel() {
    dragRef.current = null;
    setTrack(0, true);
  }

  // 鍵盤:ESC 關閉、←→ 切換
  useEffect(() => {
    if (!open) return;
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
  }, [open, idx, hasPrev, hasNext, paths, onChange]);

  // 開啟期間鎖定背景頁面捲動;關閉或 unmount 時還原並取消未完成的翻頁動畫
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      cancelSettleRef.current?.();
    };
  }, [open]);

  if (!path) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => onChange(null)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      className="fixed inset-0 z-[70] flex touch-none flex-col items-center justify-center overscroll-contain bg-black/85 p-4"
    >
      {/* 滑軌視窗:overflow-hidden,裡面三格並排跟著手指移動 */}
      <div
        className="w-full flex-1 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={trackRef}
          className="flex h-full will-change-transform"
          style={{ transform: "translateX(calc(-33.3333% + 0px))" }}
        >
          {[idx - 1, idx, idx + 1].map((i) => (
            <div
              key={i}
              className="flex h-full w-full shrink-0 items-center justify-center"
            >
              {items[i] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={items[i].path}
                  alt={items[i].caption ?? ""}
                  draggable={false}
                  className="max-h-full max-w-full select-none object-contain"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 照片說明 — 圖下方,點不會關閉。空字串 / null 不渲染。
          手機優先:文字加大為 base/lg,讓現場拿手機看的人不用瞇眼;
          有捲軸時改為左對齊讀起來比較順。touch-pan-y + stopPropagation:
          在說明上垂直捲動說明本身,不會拖動照片或背景 */}
      {caption && (
        <div
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          className="mt-3 max-h-[32vh] w-full max-w-3xl touch-pan-y overflow-y-auto rounded-md bg-black/65 px-4 py-3 text-left text-base leading-relaxed text-white whitespace-pre-line md:text-lg"
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
