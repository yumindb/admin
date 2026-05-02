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
export default async function WorkItemsReportPage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role === "field_assistant") redirect("/");

  const supabase = await createClient();
  const { data: allCases } = await supabase.from("cases").select("*");
  let cases = (allCases ?? []) as Case[];

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
