"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PhotoLightbox } from "@/components/photo-lightbox";

/**
 * 案件照片時間軸 — 全案照片依日期分組,新的在上。
 *
 * 對齊 PlanGrid 的照片時間軸概念:驗收爭議 / 追加佐證時,
 * 「5 月 12 號那面牆長什麼樣」要十秒內找到。
 *
 * - sticky 日期標頭 + 月份快跳 chips(案件橫跨數月時不用狂捲)
 * - 來源標記:日誌照片(正式紀錄)與現場回報照片(未併入日誌的)都收,
 *   依 storage path 去重、日誌優先;回報照片掛「回報」徽章
 * - 每組標頭可連回當天的日誌 / 回報原文件
 * - IntersectionObserver 漸進載入:幾百張照片也不會一次 render 爆手機
 */

export type TimelinePhoto = {
  /** 已簽名的顯示 URL */
  src: string;
  caption: string;
  /** 台北時區日期 "YYYY-MM-DD"(日誌用 log_date,回報用 created_at 轉) */
  date: string;
  source: "log" | "report";
  /** 連回原文件 */
  href: string;
};

type Group = {
  date: string;
  photos: TimelinePhoto[];
  links: { href: string; label: string }[];
};

/** 首批 render 的照片數(以組為單位累積到門檻) */
const INITIAL_PHOTOS = 48;
const BATCH_PHOTOS = 96;

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function formatGroupDate(date: string): string {
  // date 是 "YYYY-MM-DD"(台北自然日),直接拆字串,避免又踩時區
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m} 月 ${d} 日（${weekday}）`;
}

function monthKey(date: string): string {
  return date.slice(0, 7); // "YYYY-MM"
}

function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${y} 年 ${m} 月`;
}

export function CasePhotoTimeline({ photos }: { photos: TimelinePhoto[] }) {
  const [lightboxPath, setLightboxPath] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | "log" | "report">(
    "all",
  );
  const [visiblePhotoCap, setVisiblePhotoCap] = useState(INITIAL_PHOTOS);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Map<string, HTMLElement>>(new Map());

  const hasReports = useMemo(
    () => photos.some((p) => p.source === "report"),
    [photos],
  );

  const filtered = useMemo(
    () =>
      sourceFilter === "all"
        ? photos
        : photos.filter((p) => p.source === sourceFilter),
    [photos, sourceFilter],
  );

  // 依日期分組(輸入已依日期新→舊排好)
  const groups = useMemo<Group[]>(() => {
    const byDate = new Map<string, TimelinePhoto[]>();
    for (const p of filtered) {
      const arr = byDate.get(p.date) ?? [];
      arr.push(p);
      byDate.set(p.date, arr);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, list]) => {
        // 標頭連結:同天可能多份日誌 / 多筆回報 — 去重,日誌在前
        const seen = new Set<string>();
        const links: Group["links"] = [];
        for (const p of list) {
          if (seen.has(p.href)) continue;
          seen.add(p.href);
          links.push({
            href: p.href,
            label: p.source === "log" ? "日誌" : "回報",
          });
        }
        links.sort((a, b) => (a.label === b.label ? 0 : a.label === "日誌" ? -1 : 1));
        return { date, photos: list, links };
      });
  }, [filtered]);

  // 漸進載入:以「組」為單位累積,直到照片數超過 cap
  const visibleGroups = useMemo<Group[]>(() => {
    const out: Group[] = [];
    let count = 0;
    for (const g of groups) {
      out.push(g);
      count += g.photos.length;
      if (count >= visiblePhotoCap) break;
    }
    return out;
  }, [groups, visiblePhotoCap]);
  const hasMore =
    visibleGroups.length < groups.length ||
    visibleGroups.reduce((n, g) => n + g.photos.length, 0) < filtered.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisiblePhotoCap((n) => n + BATCH_PHOTOS);
        }
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore]);

  // 換 filter 時回到首批(避免舊 cap 讓新清單直接全開)— 直接在點擊時重設,
  // 不用 effect(同步 setState in effect 會多一輪 render)
  function changeFilter(next: "all" | "log" | "report") {
    setSourceFilter(next);
    setVisiblePhotoCap(INITIAL_PHOTOS);
  }

  // 月份快跳:>1 個月才顯示
  const months = useMemo(
    () => [...new Set(groups.map((g) => monthKey(g.date)))],
    [groups],
  );

  function jumpToMonth(key: string) {
    const first = groups.find((g) => monthKey(g.date) === key);
    if (!first) return;
    // 目標組還沒 render(在漸進載入的後面)→ 先把 cap 開到該組
    const idx = groups.indexOf(first);
    const needed = groups
      .slice(0, idx + 1)
      .reduce((n, g) => n + g.photos.length, 0);
    if (needed > visiblePhotoCap) setVisiblePhotoCap(needed + BATCH_PHOTOS);
    // 等 render 完再捲(cap 沒變時當下就捲得到)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        groupRefs.current.get(first.date)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  }

  if (photos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        目前沒有照片
      </div>
    );
  }

  return (
    <div>
      {/* 工具列:來源篩選 + 月份快跳 */}
      {(hasReports || months.length > 1) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {hasReports && (
            <div className="flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-card p-1">
              {(
                [
                  { value: "all", label: "全部" },
                  { value: "log", label: "日誌" },
                  { value: "report", label: "回報" },
                ] as const
              ).map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => changeFilter(f.value)}
                  aria-pressed={sourceFilter === f.value}
                  className={`inline-flex min-h-9 items-center rounded px-3 text-sm transition-colors ${
                    sourceFilter === f.value
                      ? "bg-primary text-white"
                      : "text-foreground hover:bg-[#F5F1EC]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {months.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {months.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => jumpToMonth(m)}
                  className="inline-flex min-h-9 items-center rounded-full border border-[#E0DCD6] bg-card px-3 text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
                >
                  {formatMonth(m)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          此來源沒有照片
        </div>
      ) : (
        <div className="space-y-6">
          {visibleGroups.map((g) => (
            <section
              key={g.date}
              ref={(el) => {
                if (el) groupRefs.current.set(g.date, el);
                else groupRefs.current.delete(g.date);
              }}
              style={{ scrollMarginTop: "4.5rem" }}
            >
              {/* sticky 日期標頭:捲動時知道自己在哪一天 */}
              <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-center justify-between gap-3 bg-[#F5F1EC]/95 px-1 py-2 backdrop-blur-sm">
                <h3 className="flex items-baseline gap-2 text-sm font-semibold text-primary">
                  {formatGroupDate(g.date)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {g.photos.length} 張
                  </span>
                </h3>
                <div className="flex shrink-0 items-center gap-2">
                  {g.links.slice(0, 3).map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="text-xs text-accent underline-offset-2 hover:underline"
                    >
                      {l.label} →
                    </Link>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5 md:grid-cols-5 lg:grid-cols-6">
                {g.photos.map((p, i) => (
                  <button
                    key={`${p.src}-${i}`}
                    type="button"
                    onClick={() => setLightboxPath(p.src)}
                    title={p.caption || undefined}
                    className="group relative block aspect-square cursor-zoom-in overflow-hidden rounded-md border border-[#E0DCD6] bg-white"
                    aria-label={p.caption || "放大檢視"}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.src}
                      alt={p.caption}
                      loading="lazy"
                      className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                    />
                    {p.source === "report" && (
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        回報
                      </span>
                    )}
                    {p.caption && (
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-3 text-left text-[11px] text-white">
                        {p.caption}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
          {hasMore && (
            <div ref={sentinelRef} className="py-4 text-center text-xs text-muted-foreground">
              載入更多照片…
            </div>
          )}
        </div>
      )}

      {/* lightbox 拿「目前篩選」的完整清單:點進去可以一路滑到底 */}
      <PhotoLightbox
        photos={filtered.map((p) => ({
          path: p.src,
          caption: p.caption
            ? `${formatGroupDate(p.date)}・${p.caption}`
            : formatGroupDate(p.date),
        }))}
        path={lightboxPath}
        onChange={setLightboxPath}
      />
    </div>
  );
}
