import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import type {
  Case,
  DailyLog,
  DailyLogExtraItem,
  DailyLogUnsignedItem,
} from "@/lib/types";
import { UnsignedReportClient, type UnsignedRow } from "./client";

/**
 * /reports/unsigned — 未簽約 / 合約外清單,跨案件。
 *
 * 角色:office_staff / owner / site_supervisor(自己案件);field_assistant 擋掉。
 *
 * 做法:撈所有(可看的)daily_logs 的 extra_items + unsigned_items,展平成 row。
 *  - 篩選由 client side 做(日期 / 案件 / 類型)。資料量在 POC 階段不大。
 *  - 如果未來日誌量上萬,改用 SQL `jsonb_array_elements` 在 server 篩。
 */
type RawLog = Pick<
  DailyLog,
  "id" | "case_id" | "supervisor_id" | "log_date" | "extra_items" | "unsigned_items"
> & {
  cases: { name: string; code: string | null; company: string } | null;
  supervisor: { full_name: string | null } | null;
};

export default async function UnsignedReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role === "field_assistant") redirect("/");

  const sp = await searchParams;
  const period = sp.period === "month" ? "month" : "all";

  const supabase = await createClient();

  let query = supabase
    .from("daily_logs")
    .select(
      "id, case_id, supervisor_id, log_date, extra_items, unsigned_items, cases(name, code, company), supervisor:profiles!supervisor_id(full_name)",
    )
    .in("status", ["submitted", "approved"])
    .order("log_date", { ascending: false });

  if (actor.role === "site_supervisor") {
    query = query.eq("supervisor_id", actor.id);
  }

  const { data: rawLogs } = await query;
  const logs = (rawLogs ?? []) as unknown as RawLog[];

  // 額外案件清單(給 filter 用)— 從 logs 裡 distinct
  const caseMap = new Map<string, Pick<Case, "id" | "name" | "code" | "company">>();
  for (const l of logs) {
    if (l.cases && l.case_id && !caseMap.has(l.case_id)) {
      caseMap.set(l.case_id, {
        id: l.case_id,
        name: l.cases.name,
        code: l.cases.code,
        company: l.cases.company,
      });
    }
  }
  const cases = [...caseMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-Hant"),
  );

  // 展平
  const rows: UnsignedRow[] = [];
  for (const l of logs) {
    const supervisorName = l.supervisor?.full_name ?? "—";
    for (const e of (l.extra_items ?? []) as DailyLogExtraItem[]) {
      rows.push({
        kind: "extra",
        logId: l.id,
        logDate: l.log_date,
        caseId: l.case_id,
        caseName: l.cases?.name ?? "（已刪除）",
        caseCompany: l.cases?.company ?? "",
        supervisorName,
        name: e.name ?? "",
        unit: e.unit ?? null,
        qty: e.qty ?? null,
        headcount: e.headcount ?? null,
        location: e.location ?? null,
        requestedBy: e.requested_by ?? null,
        category: null,
        quoteAmount: null,
        reason: e.reason ?? null,
      });
    }
    for (const u of (l.unsigned_items ?? []) as DailyLogUnsignedItem[]) {
      rows.push({
        kind: "unsigned",
        logId: l.id,
        logDate: l.log_date,
        caseId: l.case_id,
        caseName: l.cases?.name ?? "（已刪除）",
        caseCompany: l.cases?.company ?? "",
        supervisorName,
        name: u.name ?? "",
        unit: u.unit ?? null,
        qty: u.qty ?? null,
        headcount: u.headcount ?? null,
        location: null,
        requestedBy: null,
        category: u.category ?? null,
        quoteAmount: u.quote_amount ?? null,
        reason: u.reason ?? null,
      });
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-5">
        <nav className="mb-2 text-sm text-muted-foreground">
          <Link href="/reports" className="hover:text-accent">
            報表
          </Link>
          <span className="mx-1.5">／</span>
          <span>未簽約 / 超工</span>
        </nav>
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">
          未簽約 / 超工項目
        </h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          所有日誌中登記的合約外、點工、變更追加項目 — 月底用來核對追加報價
        </p>
      </div>

      <UnsignedReportClient
        rows={rows}
        cases={cases}
        initialPeriod={period}
      />
    </div>
  );
}
