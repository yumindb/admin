import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewLogForm, type CaseOption, type PendingFieldReport } from "./new-log-form";
import type { PickerItem } from "@/components/work-items-picker";
import { computeWorkItemAggregates } from "@/lib/work-item-aggregates";
import {
  computeManpowerByCase,
  computeSubcontractorTotalsByCase,
  computeMachineTotalsByCase,
} from "@/lib/daily-log";
import type { DailyLogWorkItem, FieldReport } from "@/lib/types";

export default async function NewLogPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const { case: presetCaseId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user!.id)
    .maybeSingle();
  if (profile?.role !== "site_supervisor" && profile?.role !== "owner") {
    redirect("/logs");
  }

  const { data: cases } = await supabase
    .from("cases")
    .select("id, name, code, company, location, expected_end")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const caseIds = (cases ?? []).map((c) => c.id);
  const { data: workItems } = caseIds.length
    ? await supabase
        .from("case_work_items")
        .select(
          "id, case_id, parent_id, depth, item_type, tender_code, name, unit, quantity, sort_path"
        )
        .in("case_id", caseIds)
        .eq("skipped", false)
        .order("sort_path", { ascending: true })
    : { data: [] };

  const grouped = new Map<string, PickerItem[]>();
  for (const w of workItems ?? []) {
    const arr = grouped.get(w.case_id as string) ?? [];
    arr.push({
      id: w.id as string,
      parentId: w.parent_id as string | null,
      depth: w.depth as number,
      itemType: w.item_type as PickerItem["itemType"],
      tenderCode: w.tender_code as string | null,
      name: w.name as string,
      unit: w.unit as string | null,
      totalQuantity: w.quantity as number | null,
    });
    grouped.set(w.case_id as string, arr);
  }

  const caseOptions: CaseOption[] = (cases ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    code: c.code as string | null,
    company: c.company as string,
    location: c.location as string | null,
    expectedEnd: c.expected_end as string | null,
    workItems: grouped.get(c.id as string) ?? [],
  }));

  // 撈這些案件的所有 daily_logs:
  // 1. case_id + log_date → 算「該案件當天第幾份」(所有狀態都算,避免序號跳號)
  // 2. submitted/approved 的 work_items → 算各工項「已累計」+ 鎖定 qty_mode
  const { data: existingLogs } = caseIds.length
    ? await supabase
        .from("daily_logs")
        .select("id, case_id, log_date, created_at, work_items, manpower, status")
        .in("case_id", caseIds)
    : { data: [] };

  const dayLogCounts: Record<string, Record<string, number>> = {};
  for (const l of existingLogs ?? []) {
    const cid = l.case_id as string;
    const ld = l.log_date as string;
    dayLogCounts[cid] ??= {};
    dayLogCounts[cid][ld] = (dayLogCounts[cid][ld] ?? 0) + 1;
  }

  const priorRows = (existingLogs ?? []).filter(
    (l) => l.status === "submitted" || l.status === "approved",
  );
  const priorLogs = priorRows.map((l) => ({
    id: l.id as string,
    case_id: l.case_id as string,
    created_at: l.created_at as string,
    work_items: (l.work_items as DailyLogWorkItem[] | null) ?? [],
  }));
  const aggregates = computeWorkItemAggregates(priorLogs);
  const priorManpowerByCase = computeManpowerByCase(
    priorRows.map((l) => ({
      id: l.id as string,
      case_id: l.case_id as string,
      today_total: (l.manpower as { today_total?: number } | null)?.today_total,
    })),
  );
  const priorSubcontractorByCase = computeSubcontractorTotalsByCase(
    priorRows.map((l) => ({
      id: l.id as string,
      case_id: l.case_id as string,
      subcontractors:
        (l.manpower as { subcontractors?: { trade?: string; today?: number }[] } | null)
          ?.subcontractors ?? [],
    })),
  );
  const priorMachineByCase = computeMachineTotalsByCase(
    priorRows.map((l) => ({
      id: l.id as string,
      case_id: l.case_id as string,
      machines:
        (l.manpower as { machines?: { name?: string; today?: number }[] } | null)
          ?.machines ?? [],
    })),
  );

  // 撈這些案件的 pending 現場回報,主任填日誌時可以勾選整合進來
  const { data: reportRows } = caseIds.length
    ? await supabase
        .from("field_reports")
        .select("id, case_id, note, photos, created_at, author:profiles!author_id(full_name)")
        .in("case_id", caseIds)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
    : { data: [] };

  type ReportRowWithAuthor = Pick<
    FieldReport,
    "id" | "case_id" | "note" | "photos" | "created_at"
  > & {
    author: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const pendingReportsByCase: Record<string, PendingFieldReport[]> = {};
  for (const row of (reportRows ?? []) as unknown as ReportRowWithAuthor[]) {
    const author = Array.isArray(row.author) ? row.author[0] : row.author;
    const list = pendingReportsByCase[row.case_id] ?? [];
    list.push({
      id: row.id,
      caseId: row.case_id,
      note: row.note ?? "",
      photos: row.photos ?? [],
      authorName: author?.full_name ?? "未命名",
      createdAt: row.created_at,
    });
    pendingReportsByCase[row.case_id] = list;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/logs" className="hover:text-accent">
          日誌
        </Link>
        <span className="mx-1.5">／</span>
        <span>新日誌</span>
      </nav>
      <h1 className="mb-7 text-2xl font-semibold text-primary md:text-3xl">新日誌</h1>

      <NewLogForm
        cases={caseOptions}
        presetCaseId={presetCaseId}
        currentUserName={profile?.full_name ?? user?.email ?? "未命名使用者"}
        dayLogCounts={dayLogCounts}
        priorAggregates={aggregates}
        priorManpowerByCase={priorManpowerByCase}
        priorSubcontractorByCase={priorSubcontractorByCase}
        priorMachineByCase={priorMachineByCase}
        pendingReportsByCase={pendingReportsByCase}
      />
    </div>
  );
}
