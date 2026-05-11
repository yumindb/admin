import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import {
  computeCrossCaseSummaryRows,
  type CrossCaseSummaryRow,
} from "@/lib/excel/cross-case-summary";
import type { Case, CaseWorkItem, DailyLogWorkItem } from "@/lib/types";
import { WorkItemsReportClient } from "./client";

/**
 * 跨案工項累計報表。
 *
 * 角色:office_staff / owner / site_supervisor(看自己的);field_assistant 擋掉。
 *
 * server side:撈出該角色可看的所有 cases 與其 work items + log work_items,
 * 算出 row 後丟給 client component 做篩選顯示。
 */
type Search = Promise<{ all?: string }>;

// 防爆上限,同 /cases 邏輯
const CASE_HARD_LIMIT = 200;

export default async function WorkItemsReportPage({
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
  const [{ data: workItems }, { data: logs }] = await Promise.all([
    supabase
      .from("case_work_items")
      .select("*")
      .in("case_id", caseIds),
    supabase
      .from("daily_logs")
      .select("case_id, work_items")
      .in("case_id", caseIds)
      .in("status", ["submitted", "approved"]),
  ]);

  const items = (workItems ?? []) as CaseWorkItem[];
  const logWorkItems: {
    case_id: string;
    work_item_id: string;
    qty: number;
    qty_mode?: "absolute" | "percent";
  }[] = [];
  for (const log of (logs ?? []) as {
    case_id: string;
    work_items: DailyLogWorkItem[] | null;
  }[]) {
    for (const w of log.work_items ?? []) {
      logWorkItems.push({
        case_id: log.case_id,
        work_item_id: w.work_item_id,
        qty: w.qty,
        qty_mode: w.qty_mode,
      });
    }
  }

  const rows: CrossCaseSummaryRow[] = computeCrossCaseSummaryRows({
    cases,
    workItems: items,
    logWorkItems,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Header />
      {hitLimit && (
        <div className="mb-4 rounded-md border border-[#F59E0B] bg-[#FEF3C7] px-4 py-3 text-sm text-[#92400E]">
          <strong>已達顯示上限:</strong>目前只顯示前 {CASE_HARD_LIMIT} 筆案件
          (依開工日排序)。案件總數已超出,請通知開發者升級為真正的分頁。
        </div>
      )}
      <div className="mb-4 flex items-center justify-end gap-3 text-sm">
        {showAll ? (
          <>
            <span className="text-muted-foreground">顯示全部(含已結案)</span>
            <Link
              href="/reports/work-items"
              className="text-[#A07850] underline-offset-2 hover:underline"
            >
              只看進行中
            </Link>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">只看進行中</span>
            <Link
              href="/reports/work-items?all=1"
              className="text-[#A07850] underline-offset-2 hover:underline"
            >
              顯示全部(含已結案)
            </Link>
          </>
        )}
      </div>
      <WorkItemsReportClient
        rows={rows}
        cases={cases.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          company: c.company,
        }))}
      />
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
        <span>工項累計(跨案)</span>
      </nav>
      <h1 className="text-2xl font-semibold text-primary md:text-3xl">
        工項累計(跨案)
      </h1>
      <p className="mt-1.5 text-base text-muted-foreground">
        篩選案件、工項名稱、完成度區間,並下載 Excel 給管理層或業主
      </p>
    </div>
  );
}
