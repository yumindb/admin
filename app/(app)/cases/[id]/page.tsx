import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatTW, formatDateTW } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import {
  type TreeItem,
  type ProgressMap,
} from "@/components/work-items-tree";
import { WorkItemsTreeSection } from "@/components/work-items-tree-section";
import { tryGetActor } from "@/lib/auth/require-role";
import { getCompanyShort } from "@/lib/companies";
import { undoImportAction } from "./import/actions";
import { DeleteCaseButton } from "./delete-case-button";
import {
  WorkItemsXlsxButton,
  MonthlyReportXlsxButton,
} from "./case-excel-buttons";
import { NextStepHint } from "@/components/next-step-hint";
import { PhotoGallery, type GalleryPhoto } from "@/components/photo-gallery";
import { normalizeLogPhotos } from "@/lib/daily-log";
import { getSignedUrls } from "@/lib/supabase/storage";
import type {
  Case,
  CaseWorkItem,
  TenderImport,
  DailyLog,
  DailyLogWorkItem,
  DailyLogExtraItem,
  DailyLogUnsignedItem,
} from "@/lib/types";

type ExtraRow = DailyLogExtraItem & {
  log_id: string;
  log_date: string;
};

type UnsignedRow = DailyLogUnsignedItem & {
  log_id: string;
  log_date: string;
};

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
      .select(
        "id, log_date, work_items, status, extra_items, unsigned_items, photos",
      )
      .eq("case_id", id)
      .in("status", ["submitted", "approved"])
      .order("log_date", { ascending: false }),
  ]);

  if (caseErr || !caseRow) notFound();
  const c = caseRow as Case;
  const actor = await tryGetActor();
  const canEditWorkItems =
    actor?.role === "office_staff" || actor?.role === "owner";
  const items = (workItems ?? []) as CaseWorkItem[];
  const importsList = (imports ?? []) as TenderImport[];
  const lastImport = importsList[0];

  type LogForCase = Pick<
    DailyLog,
    | "id"
    | "log_date"
    | "work_items"
    | "status"
    | "extra_items"
    | "unsigned_items"
    | "photos"
  >;
  const allLogs = (logs ?? []) as LogForCase[];

  // 計算每個 work_item 的累計完成量
  // qty_mode = "percent" 時 qty 是 0-1 fraction,要乘上「契約數量」換成絕對值再 sum
  const itemMeta = new Map(items.map((x) => [x.id, x]));
  const progress: ProgressMap = new Map();
  for (const log of allLogs) {
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

  // 彙整跨所有日誌的「合約外」與「未簽約」項目,附上來源日誌
  const extraRows: ExtraRow[] = [];
  const unsignedRows: UnsignedRow[] = [];
  // 跨所有日誌的照片,日期前綴附在 caption 上,給 PhotoGallery+Lightbox 用
  const allPhotos: GalleryPhoto[] = [];
  for (const log of allLogs) {
    for (const e of (log.extra_items ?? []) as DailyLogExtraItem[]) {
      extraRows.push({ ...e, log_id: log.id, log_date: log.log_date });
    }
    for (const u of (log.unsigned_items ?? []) as DailyLogUnsignedItem[]) {
      unsignedRows.push({ ...u, log_id: log.id, log_date: log.log_date });
    }
    const datePrefix = formatDateTW(log.log_date);
    for (const p of normalizeLogPhotos(log.photos)) {
      allPhotos.push({
        path: p.path,
        caption: p.caption
          ? `${datePrefix}・${p.caption}`
          : datePrefix,
      });
    }
  }

  // Storage 已轉 private → 一次撈所有照片的 signed URL(5 min)
  const photoSignedMap = await getSignedUrls(
    "daily-photos",
    allPhotos.map((p) => p.path)
  );
  const allPhotosSigned: GalleryPhoto[] = allPhotos.map((p) => ({
    ...p,
    path: photoSignedMap.get(p.path) ?? p.path,
  }));

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
        <Link href="/cases" className="hover:text-accent">
          案件總覽
        </Link>
        <span className="mx-1.5">／</span>
        <span>{c.name}</span>
      </nav>

      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">{c.code ?? "未編號"}</div>
          <h1 className="mt-1.5 text-2xl font-semibold text-primary md:text-3xl">{c.name}</h1>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-base text-muted-foreground">
            <span>
              公司：
              <span className="ml-0.5 font-medium text-foreground">
                {c.company ? getCompanyShort(c.company) : "—"}
              </span>
            </span>
            <span>地點：{c.location || "—"}</span>
            <span>業主：{c.client || "—"}</span>
            <span>
              開工：
              {c.started_at
                ? formatDateTW(c.started_at)
                : "—"}
            </span>
            <span>
              預計完工：
              {c.expected_end
                ? formatDateTW(c.expected_end)
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
            <Link href={`/cases/${id}/import`}>匯入工項</Link>
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
          value={allLogs.length}
          accent={allLogs.length > 0}
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
              {formatTW(lastImport.created_at)}
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

      {/* 下一步提示 — 看當前狀態給不同訊息 */}
      {items.length > 0 && allLogs.length === 0 && (
        <NextStepHint tone="info" className="mb-5">
          工項已建立。請工地主任登入後到「我的日誌」填日誌,送出核定後「累計完成」欄會自動累計。
        </NextStepHint>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-primary md:text-xl">工項清單</h2>
        {items.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <WorkItemsXlsxButton caseId={c.id} />
            {(actor?.role === "office_staff" || actor?.role === "owner") && (
              <MonthlyReportXlsxButton caseId={c.id} />
            )}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-20 text-center">
          <p className="mb-1.5 text-base text-foreground">尚未匯入工項</p>
          <p className="mb-6 text-sm text-muted-foreground">
            上傳 .xlsx（標單／報價單）後，工項會自動建立並依項次階層排列
          </p>
          <Button
            asChild
            size="lg"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Link href={`/cases/${id}/import`}>匯入工項</Link>
          </Button>
        </div>
      ) : (
        <WorkItemsTreeSection
          items={treeItems}
          progress={progress}
          caseId={c.id}
          editable={canEditWorkItems}
        />
      )}

      {/* 跨日誌彙整:照片 */}
      <div className="mt-10 mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-primary md:text-xl">
          施工日誌照片
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            共 {allPhotos.length} 張
          </span>
        </h2>
      </div>
      {allPhotos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          目前沒有日誌照片
        </div>
      ) : (
        <PhotoGallery photos={allPhotosSigned} layout="grid" />
      )}

      {/* 跨日誌彙整:合約外項目 */}
      <div className="mt-10 mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-primary md:text-xl">
          合約外項目（非合約內施工）
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            共 {extraRows.length} 筆
          </span>
        </h2>
      </div>
      <ExtraItemsAggregateTable
        rows={extraRows}
        emptyHint="目前沒有日誌登記合約外項目"
        cols={[
          { key: "log_date", label: "日期" },
          { key: "name", label: "施工項目" },
          { key: "unit", label: "單位" },
          { key: "qty", label: "數量", align: "right" },
          { key: "headcount", label: "人數", align: "right" },
          { key: "location", label: "位置" },
          { key: "requested_by", label: "甲方交辦" },
          { key: "reason", label: "事由" },
        ]}
      />

      {/* 跨日誌彙整:未簽約項目 */}
      <div className="mt-10 mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-primary md:text-xl">
          未簽約施工內容
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            共 {unsignedRows.length} 筆
          </span>
        </h2>
      </div>
      <ExtraItemsAggregateTable
        rows={unsignedRows}
        emptyHint="目前沒有日誌登記未簽約項目"
        cols={[
          { key: "log_date", label: "日期" },
          { key: "name", label: "施工項目" },
          { key: "unit", label: "單位" },
          { key: "qty", label: "數量", align: "right" },
          { key: "headcount", label: "人數", align: "right" },
          { key: "category", label: "類別" },
          { key: "quote_amount", label: "報價金額", align: "right" },
          { key: "reason", label: "事由" },
        ]}
      />

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

type AggregateCol<T> = {
  key: keyof T & string;
  label: string;
  align?: "left" | "right";
};

function ExtraItemsAggregateTable<
  T extends { log_id: string; log_date: string },
>({
  rows,
  cols,
  emptyHint,
}: {
  rows: T[];
  cols: AggregateCol<T>[];
  emptyHint: string;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        {emptyHint}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E0DCD6] bg-card">
      <table className="min-w-full text-base">
        <thead>
          <tr className="bg-primary text-primary-foreground">
            {cols.map((c) => (
              <th
                key={c.key}
                className={`h-12 px-4 text-sm font-medium tracking-wider ${
                  c.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[#E0DCD6]">
              {cols.map((c) => {
                const v = row[c.key];
                const display =
                  v === undefined || v === null || v === ""
                    ? "—"
                    : c.key === "log_date"
                    ? formatDateTW(String(v))
                    : String(v);
                return (
                  <td
                    key={c.key}
                    className={`h-14 px-4 align-top ${
                      c.align === "right"
                        ? "text-right tabular-nums"
                        : ""
                    }`}
                  >
                    {c.key === "log_date" ? (
                      <Link
                        href={`/logs/${row.log_id}`}
                        className="text-accent underline-offset-2 hover:underline"
                      >
                        {display}
                      </Link>
                    ) : (
                      display
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
