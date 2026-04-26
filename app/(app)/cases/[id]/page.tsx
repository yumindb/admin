import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  WorkItemsTree,
  type TreeItem,
  type ProgressMap,
} from "@/components/work-items-tree";
import { undoImportAction } from "./import/actions";
import { DeleteCaseButton } from "./delete-case-button";
import type {
  Case,
  CaseWorkItem,
  TenderImport,
  DailyLog,
  DailyLogWorkItem,
} from "@/lib/types";

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: caseRow, error: caseErr },
    { data: workItems },
    { data: imports },
    { data: logs },
  ] = await Promise.all([
    supabase.from("cases").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("case_work_items")
      .select("*")
      .eq("case_id", id)
      .order("sort_path", { ascending: true }),
    supabase
      .from("tender_imports")
      .select("*")
      .eq("case_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
    // 抓所有送出後或核定的日誌(草稿不計進度)
    supabase
      .from("daily_logs")
      .select("work_items, status")
      .eq("case_id", id)
      .in("status", ["submitted", "approved"]),
  ]);

  if (caseErr || !caseRow) notFound();
  const c = caseRow as Case;
  const items = (workItems ?? []) as CaseWorkItem[];
  const importsList = (imports ?? []) as TenderImport[];
  const lastImport = importsList[0];

  // 計算每個 work_item 的累計完成量
  // qty_mode = "percent" 時 qty 是 0-1 fraction,要乘上「契約數量」換成絕對值再 sum
  const itemMeta = new Map(items.map((x) => [x.id, x]));
  const progress: ProgressMap = new Map();
  for (const log of (logs ?? []) as Pick<DailyLog, "work_items" | "status">[]) {
    for (const w of (log.work_items ?? []) as DailyLogWorkItem[]) {
      const meta = itemMeta.get(w.work_item_id);
      const total = meta?.quantity ?? null;
      const inc =
        w.qty_mode === "percent"
          ? (total ?? 0) * w.qty   // percent → 還原成絕對量
          : w.qty;
      progress.set(
        w.work_item_id,
        (progress.get(w.work_item_id) ?? 0) + inc
      );
    }
  }

  const treeItems: TreeItem[] = items.map((it) => ({
    id: it.id,
    parentId: it.parent_id,
    depth: it.depth,
    itemType: it.item_type,
    tenderCode: it.tender_code,
    name: it.name,
    unit: it.unit,
    quantity: it.quantity,
    unitPrice: it.unit_price,
    totalPrice: it.total_price,
    brandNote: it.brand_note,
    specText: it.spec_text,
    skipped: it.skipped,
  }));

  return (
    <div className="mx-auto max-w-7xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-accent">
          案件
        </Link>
        <span className="mx-1.5">／</span>
        <span>{c.name}</span>
      </nav>

      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">{c.code ?? "未編號"}</div>
          <h1 className="mt-1.5 text-2xl font-semibold text-primary md:text-3xl">{c.name}</h1>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-base text-muted-foreground">
            <span>地點：{c.location || "—"}</span>
            <span>業主：{c.client || "—"}</span>
            <span>
              開工：
              {c.started_at
                ? new Date(c.started_at).toLocaleDateString("zh-TW")
                : "—"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-[#E0DCD6]"
          >
            <Link href={`/cases/${id}/edit`}>編輯</Link>
          </Button>
          <DeleteCaseButton
            caseId={c.id}
            caseName={c.name}
            workItemCount={items.length}
          />
          <Button
            asChild
            size="lg"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Link href={`/cases/${id}/import`}>上傳標單</Link>
          </Button>
        </div>
      </div>

      {/* 匯入資訊 */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-5">
        <Stat
          label="工項總數"
          value={items.length}
          accent={items.length > 0}
        />
        <Stat
          label="已登記日誌"
          value={(logs ?? []).length}
          accent={(logs ?? []).length > 0}
        />
        <Stat
          label="分類層"
          value={items.filter((x) => x.item_type === "section").length}
        />
        <Stat
          label="工項層"
          value={items.filter((x) => x.item_type === "item" || x.item_type === "spec").length}
        />
      </div>

      {lastImport && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E0DCD6] bg-[#FAF7F2] px-5 py-4 text-base text-muted-foreground">
          <div>
            最後匯入：
            <span className="ml-1 text-foreground">{lastImport.file_name}</span>
            <span className="ml-3 text-sm">
              {new Date(lastImport.created_at).toLocaleString("zh-TW")}
            </span>
            <span className="ml-3 text-sm">
              （新增 {lastImport.imported_count} 項，略過 {lastImport.skipped_count} 項）
            </span>
          </div>
          <form action={undoImportAction}>
            <input type="hidden" name="caseId" value={c.id} />
            <input type="hidden" name="importId" value={lastImport.id} />
            <button
              type="submit"
              className="text-sm text-[#B91C1C] underline-offset-2 hover:underline"
            >
              撤銷此次匯入
            </button>
          </form>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-primary md:text-xl">工項清單</h2>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
          <p className="mb-1.5 text-base text-foreground">尚未匯入標單</p>
          <p className="mb-6 text-sm text-muted-foreground">
            上傳 .xlsx 標單後，工項會自動建立並依項次階層排列
          </p>
          <Button
            asChild
            size="lg"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Link href={`/cases/${id}/import`}>上傳標單</Link>
          </Button>
        </div>
      ) : (
        <WorkItemsTree items={treeItems} progress={progress} />
      )}

      {c.notes && (
        <div className="mt-8 rounded-lg border border-[#E0DCD6] bg-card p-6">
          <div className="mb-2 text-sm uppercase tracking-wider text-muted-foreground">
            備註
          </div>
          <p className="whitespace-pre-line text-sm">{c.notes}</p>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#E0DCD6] bg-card p-5 md:p-6">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div
        className={`mt-1.5 text-3xl font-semibold tabular-nums md:text-4xl ${
          accent ? "stat-number" : "text-primary"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
