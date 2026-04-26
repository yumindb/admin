import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewLogForm, type CaseOption } from "../../new/new-log-form";
import type { PickerItem } from "@/components/work-items-picker";
import type { DailyLog } from "@/lib/types";

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
  if (l.supervisor_id !== user!.id) redirect(`/logs/${id}`);
  if (l.status !== "draft" && l.status !== "rejected") redirect(`/logs/${id}`);

  const { data: cases } = await supabase
    .from("cases")
    .select("id, name, code")
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
    workItems: grouped.get(c.id as string) ?? [],
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-xs text-muted-foreground">
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
      <h1 className="mb-6 text-xl font-semibold text-primary">編輯日誌</h1>

      <NewLogForm
        cases={caseOptions}
        logId={id}
        initial={{
          caseId: l.case_id,
          logDate: l.log_date,
          weather: l.weather ?? "",
          manpowerOwn: l.manpower?.own ?? 0,
          manpowerContract: l.manpower?.contract ?? 0,
          workItems: l.work_items ?? [],
          photos: l.photos ?? [],
          notes: l.notes ?? "",
        }}
      />
    </div>
  );
}
