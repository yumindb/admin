import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NewLogForm, type CaseOption } from "./new-log-form";
import type { PickerItem } from "@/components/work-items-picker";

export default async function NewLogPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const { case: presetCaseId } = await searchParams;
  const supabase = await createClient();

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
    <div className="mx-auto max-w-4xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/logs" className="hover:text-accent">
          我的日誌
        </Link>
        <span className="mx-1.5">／</span>
        <span>新日誌</span>
      </nav>
      <h1 className="mb-7 text-2xl font-semibold text-primary md:text-3xl">新日誌</h1>

      <NewLogForm cases={caseOptions} presetCaseId={presetCaseId} />
    </div>
  );
}
