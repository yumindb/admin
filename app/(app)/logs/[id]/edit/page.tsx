import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewLogForm, type CaseOption } from "../../new/new-log-form";
import type { PickerItem } from "@/components/work-items-picker";
import type { DailyLog, DailyLogWorkItem } from "@/lib/types";
import { parseWeather } from "@/lib/daily-log";
import { computeWorkItemAggregates } from "@/lib/work-item-aggregates";

export default async function EditLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!log) notFound();
  const l = log as DailyLog;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user!.id)
    .maybeSingle();
  if (profile?.role !== "site_supervisor") redirect("/logs");
  if (l.supervisor_id !== user!.id) redirect(`/logs/${id}`);
  if (l.status !== "draft" && l.status !== "rejected") redirect(`/logs/${id}`);

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

  // 計算這份日誌在當案當日是第幾份(編輯時序號不變)
  const { count: dayCount } = await supabase
    .from("daily_logs")
    .select("id", { count: "exact", head: true })
    .eq("case_id", l.case_id)
    .eq("log_date", l.log_date)
    .lte("created_at", l.created_at);
  const currentDaySeq = dayCount ?? 1;

  // 撈所有 submitted/approved 日誌的 work_items 算各工項已累計與模式鎖定;
  // 排除「自己」(編輯中的這份)避免重複計算
  const { data: priorRows } = caseIds.length
    ? await supabase
        .from("daily_logs")
        .select("id, case_id, created_at, work_items, status")
        .in("case_id", caseIds)
        .in("status", ["submitted", "approved"])
    : { data: [] };
  const priorLogs = (priorRows ?? []).map((r) => ({
    id: r.id as string,
    case_id: r.case_id as string,
    created_at: r.created_at as string,
    work_items: (r.work_items as DailyLogWorkItem[] | null) ?? [],
  }));
  const aggregates = computeWorkItemAggregates(priorLogs, id);

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/logs" className="hover:text-accent">
          日誌
        </Link>
        <span className="mx-1.5">／</span>
        <Link href={`/logs/${id}`} className="hover:text-accent">
          {new Date(l.log_date).toLocaleDateString("zh-TW")}
        </Link>
        <span className="mx-1.5">／</span>
        <span>編輯</span>
      </nav>
      <h1 className="mb-7 text-2xl font-semibold text-primary md:text-3xl">編輯日誌</h1>

      <NewLogForm
        cases={caseOptions}
        currentUserName={profile?.full_name ?? user?.email ?? "未命名使用者"}
        logId={id}
        currentDaySeq={currentDaySeq}
        priorAggregates={aggregates}
        initial={{
          caseId: l.case_id,
          logDate: l.log_date,
          weather: parseWeather(l.weather),
          manpowerTodayTotal: l.manpower?.today_total ?? 0,
          manpowerAccumulatedTotal: l.manpower?.accumulated_total ?? 0,
          subcontractors: l.manpower?.subcontractors ?? [],
          machines: l.manpower?.machines ?? [],
          workItems: l.work_items ?? [],
          extraItems: l.extra_items ?? [],
          unsignedItems: l.unsigned_items ?? [],
          photos: l.photos ?? [],
          vendorNotices: l.vendor_notices ?? "",
          notes: l.notes ?? "",
        }}
      />
    </div>
  );
}
