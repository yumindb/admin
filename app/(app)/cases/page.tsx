import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type {
  Case,
  CaseStatus,
  CaseWorkItem,
  DailyLog,
  DailyLogExtraItem,
  DailyLogUnsignedItem,
  DailyLogWorkItem,
} from "@/lib/types";

type StatusFilter = CaseStatus | "all";
type SortKey = "recent" | "oldest" | "name" | "started";

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

type CaseStats = {
  itemCount: number;
  logCount: number;
  progressPct: number | null;
  extraCount: number;
  unsignedCount: number;
};

export default async function CasesOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const supabase = await createClient();

  // 角色導向:supervisor → /logs,owner → /approvals(老闆首頁仍是核定);
  // office_staff 留在這裡看案件總覽
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role === "site_supervisor") redirect("/logs");
  }

  const sp = await searchParams;
  const statusFilter: StatusFilter =
    sp.status === "active" ||
    sp.status === "paused" ||
    sp.status === "closed" ||
    sp.status === "all"
      ? sp.status
      : "all";
  const sortKey: SortKey =
    sp.sort === "oldest" || sp.sort === "name" || sp.sort === "started"
      ? sp.sort
      : "recent";

  const [
    { data: cases, error },
    { data: workItems },
    { data: logs },
  ] = await Promise.all([
    supabase.from("cases").select("*"),
    supabase
      .from("case_work_items")
      .select("id, case_id, item_type, quantity, unit_price, total_price"),
    supabase
      .from("daily_logs")
      .select("case_id, status, work_items, extra_items, unsigned_items")
      .in("status", ["submitted", "approved"]),
  ]);

  const allCases = (cases ?? []) as Case[];
  const allItems = (workItems ?? []) as Pick<
    CaseWorkItem,
    "id" | "case_id" | "item_type" | "quantity" | "unit_price" | "total_price"
  >[];
  const allLogs = (logs ?? []) as Pick<
    DailyLog,
    "case_id" | "status" | "work_items" | "extra_items" | "unsigned_items"
  >[];

  const itemMetaById = new Map<string, (typeof allItems)[number]>();
  for (const it of allItems) itemMetaById.set(it.id, it);

  // 預先彙整每個案件的 stats
  const statsByCase = new Map<string, CaseStats>();
  for (const c of allCases) {
    statsByCase.set(c.id, {
      itemCount: 0,
      logCount: 0,
      progressPct: null,
      extraCount: 0,
      unsignedCount: 0,
    });
  }

  // 工項數 + 合約總值(僅葉節點:item / spec)
  const contractValueByCase = new Map<string, number>();
  for (const it of allItems) {
    const s = statsByCase.get(it.case_id);
    if (!s) continue;
    if (it.item_type === "item" || it.item_type === "spec") {
      s.itemCount += 1;
      const v = it.total_price ?? 0;
      contractValueByCase.set(
        it.case_id,
        (contractValueByCase.get(it.case_id) ?? 0) + v,
      );
    }
  }

  // 日誌數 / 已登記合約外 / 未簽約 / 已完成價值
  const doneValueByCase = new Map<string, number>();
  for (const log of allLogs) {
    if (!log.case_id) continue;
    const s = statsByCase.get(log.case_id);
    if (!s) continue;
    s.logCount += 1;
    s.extraCount += ((log.extra_items ?? []) as DailyLogExtraItem[]).length;
    s.unsignedCount += ((log.unsigned_items ?? []) as DailyLogUnsignedItem[]).length;

    for (const w of (log.work_items ?? []) as DailyLogWorkItem[]) {
      const meta = itemMetaById.get(w.work_item_id);
      if (!meta) continue;
      const unitPrice = meta.unit_price ?? 0;
      const totalPrice = meta.total_price ?? 0;
      // percent mode 下 qty 是 0-1 fraction,直接乘 total_price
      // absolute mode 下 qty 是自然單位數量,乘 unit_price
      const value =
        w.qty_mode === "percent" ? totalPrice * w.qty : unitPrice * w.qty;
      doneValueByCase.set(
        log.case_id,
        (doneValueByCase.get(log.case_id) ?? 0) + value,
      );
    }
  }

  for (const [caseId, s] of statsByCase) {
    const total = contractValueByCase.get(caseId) ?? 0;
    const done = doneValueByCase.get(caseId) ?? 0;
    if (total > 0) {
      s.progressPct = Math.min(100, Math.round((done / total) * 1000) / 10);
    } else if (s.itemCount === 0) {
      s.progressPct = null;
    } else {
      s.progressPct = 0;
    }
  }

  // 篩選與排序
  const filtered = allCases.filter((c) =>
    statusFilter === "all" ? true : c.status === statusFilter,
  );
  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "oldest":
        return a.created_at.localeCompare(b.created_at);
      case "name":
        return a.name.localeCompare(b.name, "zh-Hant");
      case "started":
        // 較晚開工排前;尚未開工的排最後
        if (!a.started_at && !b.started_at) return 0;
        if (!a.started_at) return 1;
        if (!b.started_at) return -1;
        return b.started_at.localeCompare(a.started_at);
      case "recent":
      default:
        return b.created_at.localeCompare(a.created_at);
    }
  });

  // 各狀態數量(供 tab 顯示)
  const counts: Record<StatusFilter, number> = {
    all: allCases.length,
    active: allCases.filter((c) => c.status === "active").length,
    paused: allCases.filter((c) => c.status === "paused").length,
    closed: allCases.filter((c) => c.status === "closed").length,
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">
            案件總覽
          </h1>
          <p className="mt-1.5 text-base text-muted-foreground">
            裕民工務目前管理的案件,可依狀態篩選與排序
          </p>
        </div>
        <Button
          asChild
          size="lg"
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link href="/cases/new">+ 開新案</Link>
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E0DCD6] bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((tab) => {
            const active = tab.key === statusFilter;
            const href = buildQuery({ status: tab.key, sort: sortKey });
            return (
              <Link
                key={tab.key}
                href={`/cases${href}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`tabular-nums ${
                    active ? "text-primary-foreground/80" : "text-muted-foreground"
                  }`}
                >
                  {counts[tab.key]}
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
              const href = buildQuery({ status: statusFilter, sort: opt.key });
              return (
                <Link
                  key={opt.key}
                  href={`/cases${href}`}
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

      {error && (
        <p className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          載入失敗:{error.message}
        </p>
      )}

      {!sorted.length ? (
        allCases.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center">
            <p className="mb-1.5 text-base text-foreground">這個篩選下沒有案件</p>
            <p className="text-sm text-muted-foreground">
              切換到「全部」可看見所有案件
            </p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((c) => {
            const stats = statsByCase.get(c.id) ?? {
              itemCount: 0,
              logCount: 0,
              progressPct: null,
              extraCount: 0,
              unsignedCount: 0,
            };
            return <CaseCard key={c.id} c={c} stats={stats} />;
          })}
        </div>
      )}
    </div>
  );
}

function buildQuery({
  status,
  sort,
}: {
  status: StatusFilter;
  sort: SortKey;
}) {
  const parts: string[] = [];
  if (status !== "all") parts.push(`status=${status}`);
  if (sort !== "recent") parts.push(`sort=${sort}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

function CaseCard({ c, stats }: { c: Case; stats: CaseStats }) {
  const s = STATUS_LABEL[c.status];
  return (
    <div className="group rounded-lg border border-[#E0DCD6] bg-card p-5 transition-colors hover:border-accent">
      <Link href={`/cases/${c.id}`} className="block">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {c.code ?? "未編號"}
          </span>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs ${s.cls}`}
          >
            {s.label}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-primary group-hover:text-accent md:text-xl">
          {c.name}
        </h3>
        <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">
          {c.location || "—"}
        </p>
      </Link>

      {/* 進度條 */}
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

      {/* 統計列 */}
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
        <span className="truncate">{c.client || c.company}</span>
        <span>
          {c.started_at
            ? `開工 ${new Date(c.started_at).toLocaleDateString("zh-TW")}`
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
        點下方按鈕開新案,接著上傳標單 .xlsx 自動建立工項
      </p>
      <Button
        asChild
        size="lg"
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Link href="/cases/new">開第一個案件</Link>
      </Button>
    </div>
  );
}
