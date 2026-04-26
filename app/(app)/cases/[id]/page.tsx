import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { WorkItemsTree, type TreeItem } from "@/components/work-items-tree";
import { undoImportAction } from "./import/actions";
import type { Case, CaseWorkItem, TenderImport } from "@/lib/types";

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: caseRow, error: caseErr }, { data: workItems }, { data: imports }] =
    await Promise.all([
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
    ]);

  if (caseErr || !caseRow) notFound();
  const c = caseRow as Case;
  const items = (workItems ?? []) as CaseWorkItem[];
  const importsList = (imports ?? []) as TenderImport[];
  const lastImport = importsList[0];

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
    <div className="mx-auto max-w-6xl">
      <nav className="mb-3 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-accent">
          案件
        </Link>
        <span className="mx-1.5">／</span>
        <span>{c.name}</span>
      </nav>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground">{c.code ?? "未編號"}</div>
          <h1 className="mt-1 text-xl font-semibold text-primary">{c.name}</h1>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
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
        <Button
          asChild
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link href={`/cases/${id}/import`}>上傳標單</Link>
        </Button>
      </div>

      {/* 匯入資訊 */}
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat
          label="工項總數"
          value={items.length}
          accent={items.length > 0}
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
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E0DCD6] bg-[#FAF7F2] px-4 py-3 text-sm text-muted-foreground">
          <div>
            最後匯入：
            <span className="ml-1 text-foreground">{lastImport.file_name}</span>
            <span className="ml-3 text-xs">
              {new Date(lastImport.created_at).toLocaleString("zh-TW")}
            </span>
            <span className="ml-3 text-xs">
              （新增 {lastImport.imported_count} 項，略過 {lastImport.skipped_count} 項）
            </span>
          </div>
          <form action={undoImportAction}>
            <input type="hidden" name="caseId" value={c.id} />
            <input type="hidden" name="importId" value={lastImport.id} />
            <button
              type="submit"
              className="text-xs text-[#B91C1C] underline-offset-2 hover:underline"
            >
              撤銷此次匯入
            </button>
          </form>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-primary">工項清單</h2>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center">
          <p className="mb-1 text-sm text-foreground">尚未匯入標單</p>
          <p className="mb-5 text-xs text-muted-foreground">
            上傳 .xlsx 標單後，工項會自動建立並依項次階層排列
          </p>
          <Button
            asChild
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Link href={`/cases/${id}/import`}>上傳標單</Link>
          </Button>
        </div>
      ) : (
        <WorkItemsTree items={treeItems} />
      )}

      {c.notes && (
        <div className="mt-8 rounded-md border border-[#E0DCD6] bg-card p-5">
          <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
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
    <div className="rounded-md border border-[#E0DCD6] bg-card p-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          accent ? "stat-number" : "text-primary"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
