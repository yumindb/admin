"use server";

/**
 * /reports 區塊的下載 server actions。
 *
 * - getCrossCaseSummaryXlsxAction:跨案工項累計 Excel
 *   需要 office_staff / owner / site_supervisor;site_supervisor 只看自己的案件
 *   (filter 在 RLS 補強前先用 supervisor_id ⇒ daily_logs 反查 case_id 做近似;
 *    這裡只擋下載,UI 篩選已先擋 case 列表)。
 */
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { wrapDbError } from "@/lib/db/wrap-error";
import {
  buildCrossCaseSummaryXlsx,
  computeCrossCaseSummaryRows,
} from "@/lib/excel/cross-case-summary";
import type { Case, CaseWorkItem, DailyLogWorkItem } from "@/lib/types";
import type { ExcelDownloadResult } from "@/app/(app)/cases/[id]/excel-actions";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function todayCompact(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return fmt.replace(/-/g, "");
}

export async function getCrossCaseSummaryXlsxAction(
  caseIds: string[],
): Promise<ExcelDownloadResult> {
  const actor = await requireRole(["office_staff", "owner", "site_supervisor"]);
  const supabase = await createClient();

  // 撈 cases — 先撈所有,再依角色 filter
  const casesQuery = supabase.from("cases").select("*");
  const { data: allCases, error: caseErr } = await casesQuery;
  if (caseErr)
    return { ok: false, error: wrapDbError(caseErr, "讀取案件失敗").message };

  let cases = (allCases ?? []) as Case[];

  // site_supervisor:只看「自己有送過 daily_logs 的 case_id」
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

  // 套上 caller 的篩選
  if (caseIds.length > 0) {
    const set = new Set(caseIds);
    cases = cases.filter((c) => set.has(c.id));
  }

  if (cases.length === 0) {
    return { ok: false, error: "沒有可匯出的案件" };
  }

  const allowedCaseIds = cases.map((c) => c.id);

  const [
    { data: workItems, error: wiErr },
    { data: logs, error: logErr },
  ] = await Promise.all([
    supabase
      .from("case_work_items")
      .select("*")
      .in("case_id", allowedCaseIds),
    supabase
      .from("daily_logs")
      .select("case_id, work_items")
      .in("case_id", allowedCaseIds)
      .in("status", ["submitted", "approved"]),
  ]);

  if (wiErr) return { ok: false, error: wrapDbError(wiErr, "讀取工項失敗").message };
  if (logErr) return { ok: false, error: wrapDbError(logErr, "讀取日誌失敗").message };

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

  const rows = computeCrossCaseSummaryRows({
    cases,
    workItems: items,
    logWorkItems,
  });

  const buf = buildCrossCaseSummaryXlsx(rows);
  const fileName = `跨案工項累計-${todayCompact()}.xlsx`;
  return {
    ok: true,
    dataUrl: `data:${XLSX_MIME};base64,${buf.toString("base64")}`,
    fileName,
  };
}
