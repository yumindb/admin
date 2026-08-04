import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/db/fetch-all";
import { tryGetActor } from "@/lib/auth/require-role";
import type { Case, CaseWorkItem, DailyLog } from "@/lib/types";
import {
  computeCaseProgress,
  daysSince,
  isCaseBehind,
  plannedDaysBetween,
  primaryProgressPct,
  type CaseStats,
} from "@/lib/case-progress";
import { CasesOverviewReportClient, type CaseOverviewRow } from "./client";

/**
 * /reports/cases-overview — 案件進度總覽表(報表版)。
 *
 * 與 /cases 不同點:
 *  - 整齊表格(可排序),不是卡片
 *  - 內含落後標記、累計日誌數
 *  - 以 PDF / Excel 為導向設計欄位
 *
 * 角色:office_staff / owner / site_supervisor(只看自己有送過 daily_logs 的案件)。
 *      field_assistant 擋掉。
 */
type Search = Promise<{ all?: string }>;

// 防爆上限,同 /cases 邏輯
const CASE_HARD_LIMIT = 200;

export default async function CasesOverviewReportPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const params = await searchParams;
  const showAll = params.all === "1";

  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role === "field_assistant") redirect("/");

  const supabase = await createClient();
  // 預設只看 active + paused;showAll=1 才撈 closed;再加 HARD_LIMIT 防爆
  let caseQuery = supabase
    .from("cases")
    .select("*")
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(CASE_HARD_LIMIT);
  if (!showAll) {
    caseQuery = caseQuery.in("status", ["active", "paused"]);
  }
  const { data: allCases } = await caseQuery;
  let cases = (allCases ?? []) as Case[];
  const hitLimit = cases.length >= CASE_HARD_LIMIT;

  if (actor.role === "site_supervisor") {
    const { data: myLogs } = await supabase
      .from("daily_logs")
      .select("case_id")
      .eq("supervisor_id", actor.id);
    const allowed = new Set<string>(
      (myLogs ?? []).map((l: { case_id: string }) => l.case_id),
    );
    cases = cases.filter((c) => allowed.has(c.id));
  }

  if (cases.length === 0) {
    return (
      <div className="mx-auto max-w-6xl">
        <Header />
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          目前沒有可顯示的案件
        </div>
      </div>
    );
  }

  const caseIds = cases.map((c) => c.id);
  // fetchAllRows:跨案工項/日誌會超 PostgREST 1000 筆上限
  const [{ data: workItems }, { data: logs }] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("case_work_items")
        .select("id, case_id, item_type, quantity, total_price, skipped")
        .in("case_id", caseIds)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("daily_logs")
        .select("id, case_id, work_items, log_date, status")
        .in("case_id", caseIds)
        .in("status", ["submitted", "approved", "rejected"])
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const items = (workItems ?? []) as Pick<
    CaseWorkItem,
    "id" | "case_id" | "item_type" | "quantity" | "total_price" | "skipped"
  >[];
  const allLogs = (logs ?? []) as Pick<
    DailyLog,
    "case_id" | "work_items" | "log_date" | "status"
  >[];

  const logCountByCase = new Map<string, number>();
  for (const log of allLogs) {
    if (!log.case_id) continue;
    logCountByCase.set(log.case_id, (logCountByCase.get(log.case_id) ?? 0) + 1);
  }

  // 進度 — 與案件列表 / 儀表板同一套算法(lib/case-progress.ts)
  const progressByCase = computeCaseProgress(items, allLogs);

  const today = new Date();
  const rows: CaseOverviewRow[] = cases.map((c) => {
    const p = progressByCase.get(c.id);
    const progressPct = primaryProgressPct(p);
    const stats: CaseStats = {
      itemCount: 0,
      logCount: 0,
      progressPct,
      itemProgressPct: p?.itemPct ?? null,
      extraCount: 0,
      unsignedCount: 0,
      photos: [],
      photoTotal: 0,
      startedDaysAgo: daysSince(c.started_at, today),
      plannedDays: plannedDaysBetween(c.started_at, c.expected_end),
    };
    return {
      caseId: c.id,
      caseName: c.name,
      caseCode: c.code,
      company: c.company,
      status: c.status,
      startedAt: c.started_at,
      progressPct,
      itemProgressPct: p?.itemPct ?? null,
      logCount: logCountByCase.get(c.id) ?? 0,
      behind: isCaseBehind(stats),
    };
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Header />
      {hitLimit && (
        <div className="mb-4 rounded-md border border-[#F59E0B] bg-[#FEF3C7] px-4 py-3 text-sm text-[#92400E]">
          <strong>已達顯示上限：</strong>目前只顯示前 {CASE_HARD_LIMIT} 筆案件
          （依開工日排序）。案件總數已超出，請通知開發者升級為真正的分頁。
        </div>
      )}
      <div className="mb-4 flex items-center justify-end gap-3 text-sm">
        {showAll ? (
          <>
            <span className="text-muted-foreground">顯示全部（含已結案）</span>
            <Link
              href="/reports/cases-overview"
              className="text-[#A07850] underline-offset-2 hover:underline"
            >
              只看進行中
            </Link>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">只看進行中</span>
            <Link
              href="/reports/cases-overview?all=1"
              className="text-[#A07850] underline-offset-2 hover:underline"
            >
              顯示全部（含已結案）
            </Link>
          </>
        )}
      </div>
      <CasesOverviewReportClient rows={rows} />
    </div>
  );
}

function Header() {
  return (
    <div className="mb-5">
      <nav className="mb-2 text-sm text-muted-foreground">
        <Link href="/reports" className="hover:text-accent">
          報表
        </Link>
        <span className="mx-1.5">／</span>
        <span>案件進度總覽</span>
      </nav>
      <h1 className="text-2xl font-semibold text-primary md:text-3xl">
        案件進度總覽
      </h1>
      <p className="mt-1.5 text-base text-muted-foreground">
        所有案件的進度、累計日誌數與落後標記。可依進度、開工日期或落後狀況排序
      </p>
    </div>
  );
}
