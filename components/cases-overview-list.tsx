"use client";

/**
 * 案件總覽列表 client wrapper —
 *   - 公司 tab(動態從 cases 撈 distinct company,空時隱藏)
 *   - status tab + sort 改用 URL searchParams,但 company 是純 client-side filter
 *   - 「進度落後」filter(由 KPI 卡點擊觸發);< 30% 且開工 > 60 天前
 *
 * cases 已由 server 端撈完(含 stats),這裡只做篩選與排序顯示。
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { formatDateTW } from "@/lib/datetime";
import {
  isCaseBehind,
  caseHealth,
  CASE_HEALTH_LABEL,
  type CaseStats,
  type CaseHealth,
} from "@/lib/case-progress";
import { getCompanyShort } from "@/lib/companies";
import type { Case, CaseStatus, LogPhoto } from "@/lib/types";

// re-export 讓既有 import { CaseStats } from this file 仍可用
export type { CaseStats };
export { isCaseBehind };

type StatusFilter = CaseStatus | "all";
type SortKey = "recent" | "oldest" | "name" | "started";
type ExtraFilter = "behind" | null;

const STATUS_LABEL: Record<CaseStatus, { label: string; cls: string }> = {
  active: { label: "進行中", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  paused: { label: "暫停", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  closed: { label: "結案", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
};

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "進行中" },
  { key: "paused", label: "暫停" },
  { key: "closed", label: "結案" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "最新建立" },
  { key: "oldest", label: "最早建立" },
  { key: "name", label: "名稱" },
  { key: "started", label: "開工日期" },
];

export function CasesOverviewList({
  cases,
  statsMap,
}: {
  cases: Case[];
  statsMap: Record<string, CaseStats>;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const statusFilter: StatusFilter = (() => {
    const v = sp.get("status");
    return v === "active" || v === "paused" || v === "closed" || v === "all"
      ? v
      : "all";
  })();
  const sortKey: SortKey = (() => {
    const v = sp.get("sort");
    return v === "oldest" || v === "name" || v === "started" ? v : "recent";
  })();
  const extraFilter: ExtraFilter =
    sp.get("filter") === "behind" ? "behind" : null;

  // company 與搜尋字串也進 URL:點進案件再返回,篩選才不會歸零
  // (status/sort/filter 本來就在 URL,這兩個是漏網之魚)
  const companyFilter = sp.get("company") ?? "all";
  const [searchQuery, setSearchQuery] = useState<string>(
    () => sp.get("q") ?? "",
  );

  // 搜尋是打字即濾,用 debounce + replace(不塞 history)同步回 URL
  useEffect(() => {
    const current = sp.get("q") ?? "";
    if (searchQuery === current) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(sp.toString());
      if (searchQuery.trim()) next.set("q", searchQuery);
      else next.delete("q");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // 動態撈 distinct company(避免 hardcode);保留出現順序但去重
  const companies = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of cases) {
      const v = (c.company ?? "").trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }, [cases]);

  function buildHref(params: {
    status?: StatusFilter;
    sort?: SortKey;
    filter?: ExtraFilter;
  }) {
    const next = new URLSearchParams(sp.toString());
    const status = params.status ?? statusFilter;
    const sort = params.sort ?? sortKey;
    const filter = params.filter !== undefined ? params.filter : extraFilter;
    if (status === "all") next.delete("status");
    else next.set("status", status);
    if (sort === "recent") next.delete("sort");
    else next.set("sort", sort);
    if (!filter) next.delete("filter");
    else next.set("filter", filter);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function clearExtraFilter() {
    router.push(buildHref({ filter: null }));
  }

  function setCompanyInUrl(company: string) {
    const next = new URLSearchParams(sp.toString());
    if (company === "all") next.delete("company");
    else next.set("company", company);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // 套 company filter
  const byCompany = cases.filter((c) =>
    companyFilter === "all" ? true : (c.company ?? "") === companyFilter,
  );

  // 套 status filter
  const byStatus = byCompany.filter((c) =>
    statusFilter === "all" ? true : c.status === statusFilter,
  );

  // 套 extra filter(進度落後)
  const byExtraFilter = byStatus.filter((c) => {
    if (extraFilter === "behind") {
      const s = statsMap[c.id];
      return s ? isCaseBehind(s) : false;
    }
    return true;
  });

  // 套搜尋(案件名稱 / 案號 / 業主 / 地點),純 client-side
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? byExtraFilter.filter((c) => {
        const hay = [c.name, c.code, c.client, c.location]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
    : byExtraFilter;

  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "oldest":
        return a.created_at.localeCompare(b.created_at);
      case "name":
        return a.name.localeCompare(b.name, "zh-Hant");
      case "started":
        if (!a.started_at && !b.started_at) return 0;
        if (!a.started_at) return 1;
        if (!b.started_at) return -1;
        return b.started_at.localeCompare(a.started_at);
      case "recent":
      default:
        return b.created_at.localeCompare(a.created_at);
    }
  });

  // status tab 數字依 byCompany 計算(在當前公司 tab 內的)
  const statusCounts: Record<StatusFilter, number> = {
    all: byCompany.length,
    active: byCompany.filter((c) => c.status === "active").length,
    paused: byCompany.filter((c) => c.status === "paused").length,
    closed: byCompany.filter((c) => c.status === "closed").length,
  };

  return (
    <>
      {/* Company tabs（僅有 ≥1 公司時才顯示） */}
      {companies.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#E0DCD6] bg-card px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            公司
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <CompanyPill
              label="全部"
              count={cases.length}
              active={companyFilter === "all"}
              onClick={() => setCompanyInUrl("all")}
            />
            {companies.map((co) => {
              const count = cases.filter((c) => (c.company ?? "") === co).length;
              return (
                <CompanyPill
                  key={co}
                  label={getCompanyShort(co)}
                  count={count}
                  active={companyFilter === co}
                  onClick={() => setCompanyInUrl(co)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 搜尋：案件名稱 / 案號 / 業主 / 施工地點 — 200 筆內快速找特定案件 */}
      <div className="mb-3 rounded-lg border border-[#E0DCD6] bg-card px-4 py-2.5">
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">搜尋</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="案件名稱、案號、業主或施工地點"
            className="h-11 flex-1 rounded-md border border-[#E0DCD6] bg-white px-3 text-base outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-muted-foreground hover:border-accent hover:text-accent"
              aria-label="清除搜尋"
            >
              清除
            </button>
          )}
        </label>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E0DCD6] bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((tab) => {
            const active = tab.key === statusFilter;
            return (
              <Link
                key={tab.key}
                href={buildHref({ status: tab.key })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`tabular-nums ${
                    active
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground"
                  }`}
                >
                  {statusCounts[tab.key]}
                </span>
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">排序</span>
          <div className="flex items-center gap-1">
            {SORT_OPTIONS.map((opt) => {
              const active = opt.key === sortKey;
              return (
                <Link
                  key={opt.key}
                  href={buildHref({ sort: opt.key })}
                  className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                    active
                      ? "bg-[#F5F1EC] text-primary"
                      : "text-muted-foreground hover:text-primary"
                  }`}
                >
                  {opt.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {extraFilter === "behind" && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-2.5 text-sm text-[#B91C1C]">
          <span>已套用「進度落後」篩選 — 只顯示開工 {">"}60 天且進度 {"<"}30% 的案件</span>
          <button
            type="button"
            onClick={clearExtraFilter}
            className="rounded-md border border-[#FCA5A5] bg-white px-2.5 py-1 text-xs hover:bg-[#FEE2E2]"
          >
            清除篩選
          </button>
        </div>
      )}

      {!sorted.length ? (
        cases.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center">
            <p className="mb-1.5 text-base text-foreground">
              {q ? `找不到符合「${searchQuery}」的案件` : "這個篩選下沒有案件"}
            </p>
            <p className="text-sm text-muted-foreground">
              {q
                ? "試試其他關鍵字，或切換公司／狀態 tab"
                : "切換其他公司／狀態 tab 可看到更多案件"}
            </p>
          </div>
        )
      ) : (
        <>
        {q && (
          <p className="mb-3 text-sm text-muted-foreground">
            搜尋「{searchQuery}」找到 {sorted.length} 筆
          </p>
        )}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((c) => (
            <CaseCard
              key={c.id}
              c={c}
              stats={
                statsMap[c.id] ?? {
                  itemCount: 0,
                  logCount: 0,
                  progressPct: null,
                  extraCount: 0,
                  unsignedCount: 0,
                  photos: [],
                  photoTotal: 0,
                  startedDaysAgo: null,
                }
              }
            />
          ))}
        </div>
        </>
      )}
    </>
  );
}

function CompanyPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-accent bg-[#F5F1EC] text-primary"
          : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
      }`}
    >
      <span>{label}</span>
      <span
        className={`tabular-nums ${
          active ? "text-primary/80" : "text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// Health chip 樣式 — 對齊 dashboard / today-attendance 的紅綠燈調色
const HEALTH_CLS: Record<CaseHealth, string> = {
  red: "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]",
  amber: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
  green: "border-[#A7F3D0] bg-[#ECFDF5] text-[#15803D]",
};
const HEALTH_DOT: Record<CaseHealth, string> = {
  red: "bg-[#B91C1C]",
  amber: "bg-[#D97706]",
  green: "bg-[#4A7C59]",
};

function CaseCard({ c, stats }: { c: Case; stats: CaseStats }) {
  const s = STATUS_LABEL[c.status];
  // active 案件才算健康度;暫停 / 結案維持原狀態 chip
  const health: CaseHealth | null = c.status === "active" ? caseHealth(stats) : null;
  return (
    <div className="group rounded-lg border border-[#E0DCD6] bg-card p-5 transition-colors hover:border-accent">
      <Link href={`/cases/${c.id}`} className="block">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-md border border-[#E0DCD6] bg-[#F5F1EC] px-2 py-0.5 text-xs font-medium text-primary">
              {c.company ? getCompanyShort(c.company) : "—"}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {c.code ?? "未編號"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {health && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${HEALTH_CLS[health]}`}
                title={`案件健康度：${CASE_HEALTH_LABEL[health]}`}
              >
                <span aria-hidden className={`inline-block size-1.5 rounded-full ${HEALTH_DOT[health]}`} />
                {CASE_HEALTH_LABEL[health]}
              </span>
            )}
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs ${s.cls}`}
            >
              {s.label}
            </span>
          </div>
        </div>
        <h3 className="text-lg font-semibold text-primary group-hover:text-accent md:text-xl">
          {c.name}
        </h3>
        <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">
          {c.location || "—"}
        </p>
      </Link>

      <div className="mt-4">
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">施工總進度</span>
          <span className="tabular-nums text-foreground">
            {stats.progressPct === null ? "—" : `${stats.progressPct}%`}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#F0EBE4]">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${stats.progressPct ?? 0}%` }}
          />
        </div>
      </div>

      {stats.photos.length > 0 && (
        <Link
          href={`/logs?case=${c.id}`}
          className="mt-4 block"
          title={`此案件目前共 ${stats.photoTotal} 張日誌照片`}
        >
          <div className="grid grid-cols-4 gap-1.5">
            {stats.photos.map((p, i) => (
              <div
                key={`${p.path}-${i}`}
                className="relative aspect-square overflow-hidden rounded-md border border-[#E0DCD6] bg-[#F5F1EC]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.path}
                  alt={p.caption || ""}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {i === stats.photos.length - 1 &&
                  stats.photoTotal > stats.photos.length && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-sm font-medium text-white">
                      +{stats.photoTotal - stats.photos.length}
                    </div>
                  )}
              </div>
            ))}
          </div>
        </Link>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Link
          href={`/logs?case=${c.id}`}
          className="flex items-baseline justify-between rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-[#F5F1EC] hover:text-primary"
          title="查看此案件的施工日誌"
        >
          <span>日誌</span>
          <span className="tabular-nums font-medium text-foreground">
            {stats.logCount}
          </span>
        </Link>
        <Link
          href={`/cases/${c.id}`}
          className="flex items-baseline justify-between rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-[#F5F1EC] hover:text-primary"
          title="查看工項清單"
        >
          <span>工項</span>
          <span className="tabular-nums font-medium text-foreground">
            {stats.itemCount}
          </span>
        </Link>
        <div
          className={`flex items-baseline justify-between rounded-md px-2 py-1 ${
            stats.extraCount > 0
              ? "text-[#A07850]"
              : "text-muted-foreground"
          }`}
          title="日誌中已登記的合約外項目"
        >
          <span>合約外</span>
          <span className="tabular-nums font-medium">{stats.extraCount}</span>
        </div>
        <div
          className={`flex items-baseline justify-between rounded-md px-2 py-1 ${
            stats.unsignedCount > 0
              ? "text-[#B91C1C]"
              : "text-muted-foreground"
          }`}
          title="日誌中已登記的未簽約項目"
        >
          <span>未簽約</span>
          <span className="tabular-nums font-medium">
            {stats.unsignedCount}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-[#F0EBE4] pt-3 text-xs text-muted-foreground">
        <span className="truncate">{c.client || "—"}</span>
        <span>
          {c.started_at
            ? `開工 ${formatDateTW(c.started_at)}`
            : "尚未開工"}
        </span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
      <div className="mb-3 text-5xl text-[#E0DCD6]">＋</div>
      <p className="mb-1.5 text-base text-foreground">還沒有任何案件</p>
      <p className="mb-6 text-sm text-muted-foreground">
        點下方按鈕開新案，接著上傳 .xlsx 自動建立工項
      </p>
      <Link
        href="/cases/new"
        className="rounded-md bg-primary px-4 py-2 text-base font-medium text-primary-foreground hover:bg-primary/90"
      >
        開第一個案件
      </Link>
    </div>
  );
}
