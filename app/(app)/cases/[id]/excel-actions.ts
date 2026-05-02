"use server";

/**
 * 案件 Excel 下載 server actions。
 *
 * 兩個 action:
 *   - getCaseWorkItemsXlsxAction : 工程進度表(全 supervisor / office / owner 可)
 *   - getCaseMonthlyReportXlsxAction : 月報(限 office / owner)
 *
 * 都回 base64 dataURL — Vercel server action response 上限 4MB,典型工項 < 500 行
 * 月報 < 200 筆,buffer 約 30-300KB,base64 後 < 400KB,放心走 base64。
 *
 * Note:這裡用 createClient(anon),由 RLS / supervisor_id 判斷可讀;若未來 RLS 鎖緊,
 * site_supervisor 取自己以外案件會撈不到資料而 throw。
 */
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { wrapDbError } from "@/lib/db/wrap-error";
import { buildCaseWorkItemsXlsx } from "@/lib/excel/case-work-items";
import { buildCaseMonthlyReportXlsx } from "@/lib/excel/case-monthly-report";
import type {
  Case,
  CaseWorkItem,
  DailyLog,
  DailyLogWorkItem,
} from "@/lib/types";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type ExcelDownloadResult =
  | { ok: true; dataUrl: string; fileName: string }
  | { ok: false; error: string };

function toDataUrl(buf: Buffer): string {
  return `data:${XLSX_MIME};base64,${buf.toString("base64")}`;
}

/** 把字串內 Excel 檔名不可用字元換掉 */
function sanitizeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
}

function todayCompact(): string {
  const d = new Date();
  // Asia/Taipei YYYYMMDD
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return fmt.replace(/-/g, "");
}

/**
 * 工程進度表:標單 7 欄 + 累計完成。
 * 三角色都可下載:office_staff / owner / site_supervisor。
 */
export async function getCaseWorkItemsXlsxAction(
  caseId: string,
): Promise<ExcelDownloadResult> {
  await requireRole(["office_staff", "owner", "site_supervisor"]);
  const supabase = await createClient();

  const [
    { data: caseRow, error: caseErr },
    { data: workItems, error: wiErr },
    { data: logs, error: logErr },
  ] = await Promise.all([
    supabase.from("cases").select("*").eq("id", caseId).maybeSingle(),
    supabase
      .from("case_work_items")
      .select("*")
      .eq("case_id", caseId)
      .order("sort_path", { ascending: true }),
    supabase
      .from("daily_logs")
      .select("work_items")
      .eq("case_id", caseId)
      .in("status", ["submitted", "approved"]),
  ]);

  if (caseErr) return { ok: false, error: wrapDbError(caseErr, "讀取案件失敗").message };
  if (!caseRow) return { ok: false, error: "找不到案件" };
  if (wiErr) return { ok: false, error: wrapDbError(wiErr, "讀取工項失敗").message };
  if (logErr) return { ok: false, error: wrapDbError(logErr, "讀取日誌失敗").message };

  const c = caseRow as Case;
  const items = (workItems ?? []) as CaseWorkItem[];
  const allLogWorkItems: DailyLogWorkItem[] = [];
  for (const log of (logs ?? []) as { work_items: DailyLogWorkItem[] | null }[]) {
    for (const w of log.work_items ?? []) {
      allLogWorkItems.push(w);
    }
  }

  const buf = buildCaseWorkItemsXlsx({
    caseName: c.name,
    caseCode: c.code,
    workItems: items,
    logWorkItems: allLogWorkItems,
  });
  const fileName = sanitizeFileName(
    `${c.name}-工程進度-${todayCompact()}.xlsx`,
  );
  return { ok: true, dataUrl: toDataUrl(buf), fileName };
}

/**
 * 單案月報:當月 work_items 彙總 + extra_items + unsigned_items。
 * 限 office_staff / owner — 主任目前不需要月報。
 */
export async function getCaseMonthlyReportXlsxAction(
  caseId: string,
  year: number,
  month: number,
): Promise<ExcelDownloadResult> {
  await requireRole(["office_staff", "owner"]);

  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return { ok: false, error: "年月參數錯誤" };
  }

  const supabase = await createClient();

  // 月份範圍(用日期字串 BETWEEN,DB 端 log_date 是 DATE 欄)
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const [
    { data: caseRow, error: caseErr },
    { data: workItems, error: wiErr },
    { data: logs, error: logErr },
  ] = await Promise.all([
    supabase.from("cases").select("*").eq("id", caseId).maybeSingle(),
    supabase
      .from("case_work_items")
      .select("*")
      .eq("case_id", caseId)
      .order("sort_path", { ascending: true }),
    supabase
      .from("daily_logs")
      .select("id, log_date, work_items, extra_items, unsigned_items")
      .eq("case_id", caseId)
      .gte("log_date", monthStart)
      .lt("log_date", nextMonth)
      .in("status", ["submitted", "approved"])
      .order("log_date", { ascending: true }),
  ]);

  if (caseErr) return { ok: false, error: wrapDbError(caseErr, "讀取案件失敗").message };
  if (!caseRow) return { ok: false, error: "找不到案件" };
  if (wiErr) return { ok: false, error: wrapDbError(wiErr, "讀取工項失敗").message };
  if (logErr) return { ok: false, error: wrapDbError(logErr, "讀取日誌失敗").message };

  const c = caseRow as Case;
  const items = (workItems ?? []) as CaseWorkItem[];
  const monthLogs = (logs ?? []) as Pick<
    DailyLog,
    "id" | "log_date" | "work_items" | "extra_items" | "unsigned_items"
  >[];

  const buf = buildCaseMonthlyReportXlsx({
    caseName: c.name,
    caseCode: c.code,
    year,
    month,
    workItems: items,
    logs: monthLogs,
  });
  const fileName = sanitizeFileName(
    `${c.name}-月報-${year}${String(month).padStart(2, "0")}-${todayCompact()}.xlsx`,
  );
  return { ok: true, dataUrl: toDataUrl(buf), fileName };
}
