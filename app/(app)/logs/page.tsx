import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { BulkPdfDownloadButton } from "@/components/bulk-pdf-download-button";
import { formatWeatherSummary, isBackfilledLog } from "@/lib/daily-log";
import { formatDateTW } from "@/lib/datetime";
import type { DailyLog, LogStatus } from "@/lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]" },
  submitted: { label: "簽核中", cls: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]" },
  approved: { label: "已核定", cls: "bg-[#ECFDF5] text-[#4A7C59] border-[#A7F3D0]" },
  rejected: { label: "已退回", cls: "bg-[#FEF2F2] text-[#B91C1C] border-[#FCA5A5]" },
};

const STAGE_LABEL_SHORT: Record<string, string> = {
  fill: "填表",
  review: "複核",
  audit: "審核",
  approve: "核定",
};

type LogRow = DailyLog & { cases: { name: string; code: string | null } | null };

type CaseGroup = {
  caseId: string;
  caseName: string;
  caseCode: string | null;
  logs: LogRow[];
  latestDate: string;
  counts: Record<LogStatus, number>;
};

type Scope = "all" | "mine";

// 日期範圍 quick filter:預設 90 天涵蓋一個季度,避免列表頁全表掃。
// caseFilterId 進來時自動切 'all' — 使用者已經 drill 進單一案件,他要看全期。
const RANGE_OPTIONS = [
  { key: "30", label: "近 30 天", days: 30 },
  { key: "90", label: "近 3 個月", days: 90 },
  { key: "180", label: "近半年", days: 180 },
  { key: "all", label: "全部", days: null },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];
const DEFAULT_RANGE: RangeKey = "90";
const ALL_HARD_LIMIT = 500;

function rangeFromParam(raw: string | undefined): RangeKey {
  const found = RANGE_OPTIONS.find((o) => o.key === raw);
  return found ? found.key : DEFAULT_RANGE;
}

function dateBoundaryISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string; scope?: string; range?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .maybeSingle();

  const sp = await searchParams;
  const caseFilterId = sp.case ?? null;

  const role = profile?.role;
  const isSupervisor = role === "site_supervisor";
  const isOfficeStaff = role === "office_staff";
  const canCreateLog = isSupervisor || role === "owner";

  // 預設 scope = "all":工地主任視角反映「要找上週同事的灌漿日誌複製」也常見,
  // mine 仍然 1 click 可切。原本 supervisor 預設 mine 但反而讓人找不到歷史日誌。
  const defaultScope: Scope = "all";
  const scope: Scope =
    sp.scope === "all" || sp.scope === "mine" ? (sp.scope as Scope) : defaultScope;

  // 案件 filter 在時自動切 'all'(進案件查歷史是顯式行為,該給全期)
  const rangeKey: RangeKey = caseFilterId ? "all" : rangeFromParam(sp.range);
  const rangeOpt = RANGE_OPTIONS.find((o) => o.key === rangeKey)!;

  let query = supabase
    .from("daily_logs")
    .select("*, cases(name, code)")
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (scope === "mine") {
    query = query.eq("supervisor_id", user!.id);
  }
  if (caseFilterId) {
    query = query.eq("case_id", caseFilterId);
  }
  if (rangeOpt.days !== null) {
    query = query.gte("log_date", dateBoundaryISO(rangeOpt.days));
  } else {
    // 'all' 仍然 hard limit 防爆;到達上限會在 UI 提示「再縮日期範圍」
    query = query.limit(ALL_HARD_LIMIT);
  }

  const { data: logs, error } = await query;
  const list = (logs ?? []) as LogRow[];
  const hitAllLimit = rangeOpt.days === null && list.length >= ALL_HARD_LIMIT;

  const groups = groupByCase(list);
  const filteredCaseName =
    caseFilterId && groups.length > 0 ? groups[0].caseName : null;

  const subtitle = isOfficeStaff
    ? scope === "mine"
      ? "您個人送出的日誌"
      : "辦公室助理可查看全部日誌與簽核狀態"
    : scope === "mine"
      ? "您個人送出的日誌，依案件分組"
      : "全公司日誌，依案件分組";

  function tabHref(next: Scope): string {
    const params = new URLSearchParams();
    params.set("scope", next);
    if (caseFilterId) params.set("case", caseFilterId);
    if (!caseFilterId && rangeKey !== DEFAULT_RANGE) params.set("range", rangeKey);
    return `/logs?${params.toString()}`;
  }

  function rangeHref(next: RangeKey): string {
    const params = new URLSearchParams();
    if (scope !== defaultScope) params.set("scope", scope);
    if (next !== DEFAULT_RANGE) params.set("range", next);
    const qs = params.toString();
    return qs ? `/logs?${qs}` : "/logs";
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between gap-3 md:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-primary md:text-3xl">日誌</h1>
          <p className="mt-1 text-sm text-muted-foreground md:text-base">
            {subtitle}
          </p>
        </div>
        {/* 桌機：右上角藥丸形按鈕 */}
        {canCreateLog && (
          <Link
            href="/logs/new"
            className="hidden h-12 items-center gap-2 rounded-full border border-[#8B6845] bg-[#A07850] py-0 pl-5 pr-6 text-base font-medium tracking-wider text-white shadow-sm transition-all duration-150 hover:bg-[#8B6845] active:scale-[0.97] md:inline-flex"
          >
            <Plus className="size-5" strokeWidth={2.25} aria-hidden />
            <span>新日誌</span>
          </Link>
        )}
      </div>

      {/* 切換：所有日誌 / 我的日誌 */}
      <div
        role="tablist"
        aria-label="日誌範圍"
        className="mb-3 inline-flex w-full rounded-md border border-[#E0DCD6] bg-card p-1 md:w-auto"
      >
        <ScopeTab
          href={tabHref("all")}
          active={scope === "all"}
          label="所有日誌"
        />
        <ScopeTab
          href={tabHref("mine")}
          active={scope === "mine"}
          label="我的日誌"
        />
      </div>

      {/* 日期範圍 quick pills — 案件 filter 在時隱藏(已切全期) */}
      {!caseFilterId && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">期間：</span>
          {RANGE_OPTIONS.map((opt) => {
            const active = opt.key === rangeKey;
            return (
              <Link
                key={opt.key}
                href={rangeHref(opt.key)}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 transition-colors ${
                  active
                    ? "border-accent bg-[#F5F1EC] font-medium text-primary"
                    : "border-[#E0DCD6] bg-white text-foreground hover:border-accent"
                }`}
              >
                {opt.label}
              </Link>
            );
          })}
        </div>
      )}

      {hitAllLimit && (
        <p className="mb-4 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
          日誌很多，目前只顯示最新 {ALL_HARD_LIMIT} 筆。建議縮短期間或從上方選特定案件查看。
        </p>
      )}

      {caseFilterId && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-3 py-2 text-sm md:px-4 md:py-3">
          <span className="text-muted-foreground">已篩選案件：</span>
          <span className="font-medium text-foreground">
            {filteredCaseName ?? "（查無對應案件）"}
          </span>
          <Link
            href={`/logs?scope=${scope}`}
            className="ml-auto text-sm text-accent hover:underline"
          >
            清除篩選
          </Link>
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          載入失敗:{error.message}
        </p>
      )}

      {!list.length ? (
        <Empty scope={scope} canCreateLog={canCreateLog} />
      ) : (
        <div className="space-y-3 md:space-y-4">
          {groups.map((g, gi) => {
            const hasActionable = g.counts.draft + g.counts.submitted > 0;
            // 工地主任視角:approved 案件不該被收起來(常需要複製昨天日誌)。
            // 規則:有 actionable / 是第一組 / 該案最後一筆 ≤7 天內 → 展開。
            const daysSinceLatest = g.latestDate
              ? Math.floor(
                  (Date.now() - new Date(g.latestDate).getTime()) /
                    (24 * 60 * 60 * 1000),
                )
              : Infinity;
            const isRecent = daysSinceLatest <= 7;
            const shouldOpen = hasActionable || gi === 0 || isRecent;
            return (
              <details
                key={g.caseId}
                open={shouldOpen}
                className="group rounded-lg border border-[#E0DCD6] bg-card transition-colors hover:border-accent open:border-[#D4CFC8]"
              >
                <summary className="cursor-pointer list-none p-3.5 md:p-5 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-start justify-between gap-2.5 md:gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground md:gap-x-2 md:text-xs">
                        <span>{g.caseCode ?? "未編號"}</span>
                        <span aria-hidden>·</span>
                        <span>共 {g.logs.length} 筆</span>
                        <span aria-hidden>·</span>
                        <span>
                          最後 {formatDateTW(g.latestDate)}
                        </span>
                      </div>
                      <h3 className="break-words text-[15px] font-semibold leading-snug text-primary md:text-lg">
                        {g.caseName}
                      </h3>
                    </div>
                    <span className="mt-1 shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
                      <ChevronDown />
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 md:mt-2">
                    <div className="flex flex-wrap gap-1 md:gap-1.5">
                      {(["draft", "submitted", "approved", "rejected"] as LogStatus[])
                        .filter((s) => g.counts[s] > 0)
                        .map((s) => (
                          <span
                            key={s}
                            className={`rounded-full border px-1.5 py-0.5 text-[10px] md:px-2 md:text-xs ${STATUS[s].cls}`}
                          >
                            {STATUS[s].label} {g.counts[s]}
                          </span>
                        ))}
                    </div>
                    {g.counts.approved > 0 && (
                      <BulkPdfDownloadButton
                        logIds={g.logs
                          .filter((l) => l.status === "approved")
                          .map((l) => l.id)}
                        label={`PDF×${g.counts.approved}`}
                        labelMd={`下載 ${g.counts.approved} 份 PDF`}
                      />
                    )}
                  </div>
                </summary>
                <div className="border-t border-[#E0DCD6]">
                  <ul>
                    {g.logs.map((l, idx) => {
                      const s = STATUS[l.status] ?? STATUS.draft;
                      return (
                        <li
                          key={l.id}
                          className={`relative ${
                            idx > 0 ? "border-t border-[#F0EBE4]" : ""
                          }`}
                        >
                          <Link
                            href={`/logs/${l.id}`}
                            className="flex items-start justify-between gap-2 px-3.5 py-2.5 transition-colors hover:bg-[#F5F1EC] md:gap-3 md:px-5 md:py-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-foreground">
                                <span className="font-medium">
                                  {formatDateTW(l.log_date)}
                                </span>
                                {isBackfilledLog(l) && (
                                  <span className="rounded-full border border-[#FDBA74] bg-[#FFF7ED] px-1.5 py-0 text-[10px] text-[#C2410C]">
                                    補件
                                  </span>
                                )}
                                {l.weather && (
                                  <span className="text-[11px] text-muted-foreground md:text-xs">
                                    {formatWeatherSummary(l.weather)}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground md:mt-1 md:gap-x-4 md:text-xs">
                                <span>{l.work_items?.length ?? 0} 工項</span>
                                <span>{l.photos?.length ?? 0} 照片</span>
                                {l.notes && (
                                  <span className="line-clamp-1 max-w-[14rem] md:max-w-[20rem]">
                                    📝 {l.notes}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span
                                className={`rounded-full border px-1.5 py-0.5 text-[10px] md:px-2 md:text-xs ${s.cls}`}
                              >
                                {s.label}
                                {l.status === "submitted" && l.current_stage
                                  ? `:${STAGE_LABEL_SHORT[l.current_stage]}`
                                  : ""}
                              </span>
                            </div>
                          </Link>
                          {canCreateLog && (
                            <Link
                              href={`/logs/new?from=${l.id}`}
                              aria-label={`複製 ${formatDateTW(l.log_date)} 的日誌為新日誌`}
                              title="複製為新日誌"
                              className="absolute right-1.5 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-[#E0DCD6] hover:bg-white hover:text-accent md:right-3"
                            >
                              <CopyIcon />
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </details>
            );
          })}
        </div>
      )}

      {/* 手機 extended FAB */}
      {canCreateLog && (
        <Link
          href="/logs/new"
          aria-label="新日誌"
          className="fixed right-4 z-30 inline-flex h-14 items-center gap-2 rounded-full border border-[#8B6845] bg-[#A07850] py-0 pl-4 pr-5 text-base font-medium tracking-wider text-white transition-all duration-150 active:scale-[0.97] md:hidden"
          style={{
            bottom: "calc(84px + env(safe-area-inset-bottom))",
            boxShadow:
              "0 10px 24px -6px rgba(120, 84, 48, 0.45), 0 2px 6px rgba(0, 0, 0, 0.08)",
          }}
        >
          <Plus className="size-5" strokeWidth={2.25} aria-hidden />
          <span>新日誌</span>
        </Link>
      )}
    </div>
  );
}

function ScopeTab({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={`flex-1 rounded-[5px] px-3 py-1.5 text-center text-sm font-medium transition-colors md:flex-none md:px-5 ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-[#F5F1EC] hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

function groupByCase(list: LogRow[]): CaseGroup[] {
  const map = new Map<string, CaseGroup>();
  for (const log of list) {
    const key = log.case_id ?? "_unknown";
    let g = map.get(key);
    if (!g) {
      g = {
        caseId: key,
        caseName: log.cases?.name ?? "（已刪除案件）",
        caseCode: log.cases?.code ?? null,
        logs: [],
        latestDate: log.log_date,
        counts: { draft: 0, submitted: 0, approved: 0, rejected: 0 },
      };
      map.set(key, g);
    }
    g.logs.push(log);
    if (log.log_date > g.latestDate) g.latestDate = log.log_date;
    g.counts[log.status] = (g.counts[log.status] ?? 0) + 1;
  }
  return [...map.values()].sort((a, b) => b.latestDate.localeCompare(a.latestDate));
}

function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function Empty({
  scope,
  canCreateLog,
}: {
  scope: Scope;
  canCreateLog: boolean;
}) {
  const isMine = scope === "mine";
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center md:py-20">
      <div className="mb-3 text-5xl text-[#E0DCD6]">📋</div>
      <p className="mb-1.5 text-base text-foreground">
        {isMine ? "您還沒送出任何日誌" : "目前還沒有任何日誌"}
      </p>
      <p className="mb-6 text-sm text-muted-foreground">
        {isMine
          ? "選一個案件開新日誌，填工項數量、加照片、送出給老闆核定"
          : "工地主任送出日誌後會出現在這裡"}
      </p>
      {canCreateLog && (
        <Button
          asChild
          size="lg"
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link href="/logs/new">建第一份日誌</Link>
        </Button>
      )}
    </div>
  );
}
