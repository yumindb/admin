import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatTW, formatDateTW } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { PencilIcon } from "lucide-react";
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
import { CaseQrCodeButton } from "@/components/case-qr-code-button";
import { PhotoGallery, type GalleryPhoto } from "@/components/photo-gallery";
import { AttendanceTimeline, type TimelineEvent } from "@/components/attendance-timeline";
import {
  ExtraUnsignedSection,
  type ExtraUnsignedRow,
} from "@/components/extra-unsigned-section";
import {
  ExtraContractsSection,
  type ContractWithItems,
} from "@/components/extra-contracts-section";
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
  ExtraContract,
  QuoteStatus,
} from "@/lib/types";

type LegacyExtraRow = DailyLogExtraItem & {
  log_id: string;
  log_date: string;
};

type LegacyUnsignedRow = DailyLogUnsignedItem & {
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

  // 取最近 14 天的打卡事件(顯示在案件底部)— 200 筆硬上限與其他列表一致
  const since14d = new Date(Date.now() - 14 * 86_400_000).toISOString();

  const [
    { data: caseRow, error: caseErr },
    { data: workItems },
    { data: imports },
    { data: logs },
    { data: contracts },
    { data: attendanceRows },
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
    // migration-2.16:追加合約清單,工項屬於合約者透過 extra_contract_id join
    supabase
      .from("extra_contracts")
      .select("*")
      .eq("case_id", id)
      .order("signed_at", { ascending: false }),
    // migration-2.21:打卡事件 — 近 14 天此案件全部出勤
    supabase
      .from("attendance_events")
      .select("id, event_type, lat, lng, accuracy_m, distance_m, within_geofence, note, created_at, user_id")
      .eq("case_id", id)
      .gte("created_at", since14d)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (caseErr || !caseRow) notFound();
  const c = caseRow as Case;

  // 打卡時間軸:撈出現過的 user 名字
  const attendanceUserIds = Array.from(
    new Set(((attendanceRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)),
  );
  const attendanceUserMap = new Map<string, string>();
  if (attendanceUserIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", attendanceUserIds);
    for (const p of profs ?? []) {
      attendanceUserMap.set(p.id as string, (p.full_name as string) ?? "未命名");
    }
  }
  const timelineEvents: TimelineEvent[] = (attendanceRows ?? []).map((r) => {
    const row = r as {
      id: string;
      event_type: "clock_in" | "clock_out";
      lat: number;
      lng: number;
      accuracy_m: number | null;
      distance_m: number | null;
      within_geofence: boolean | null;
      note: string | null;
      created_at: string;
      user_id: string;
    };
    return {
      id: row.id,
      event_type: row.event_type,
      user_name: attendanceUserMap.get(row.user_id) ?? "未命名",
      case_label: null,
      lat: row.lat,
      lng: row.lng,
      accuracy_m: row.accuracy_m,
      distance_m: row.distance_m,
      within_geofence: row.within_geofence,
      note: row.note,
      created_at: row.created_at,
    };
  });
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

  // 案件級的未簽約工項 — flat 列表(合約外現在以「合約」為單位呈現,見下方 contractList)
  const unsignedItems: ExtraUnsignedRow[] = items
    .filter((it) => it.item_type === "unsigned")
    .map((it) => ({
      id: it.id,
      name: it.name,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: it.unit_price,
      totalPrice: it.total_price,
      brandNote: it.brand_note,
      itemType: "unsigned",
      quoteStatus: (it.quote_status as QuoteStatus | null) ?? null,
      contractSignedAt: null,
      contractNote: null,
    }));

  // 把 extra 工項按 extra_contract_id 分組,組成 ContractWithItems 給新版區塊用
  // 沒掛 contract 的 extra 工項(legacy 殘留)獨立成一個「未掛合約的合約外」群,
  // 顯示提示讓 office staff 補綁(罕見;migration-2.16 已搬完絕大多數)
  const extraItems = items.filter((it) => it.item_type === "extra");
  const contractList = (contracts ?? []) as ExtraContract[];
  const itemsByContract = new Map<string, CaseWorkItem[]>();
  const orphanExtraItems: CaseWorkItem[] = [];
  for (const it of extraItems) {
    if (it.extra_contract_id) {
      const arr = itemsByContract.get(it.extra_contract_id) ?? [];
      arr.push(it);
      itemsByContract.set(it.extra_contract_id, arr);
    } else {
      orphanExtraItems.push(it);
    }
  }
  const contractsForUI: ContractWithItems[] = contractList.map((c) => ({
    id: c.id,
    name: c.name,
    bundlePrice: c.bundle_price,
    note: c.note,
    signedAt: c.signed_at,
    items: (itemsByContract.get(c.id) ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: it.unit_price,
      totalPrice: it.total_price,
      brandNote: it.brand_note,
    })),
  }));
  // 沒掛任何合約、又是 extra 的(理論上不會有 — migration-2.16 全 backfill 過,
  // 此處留 fallback 給 future regression)— 用舊的 ExtraUnsignedSection 顯示
  const orphanExtraRows: ExtraUnsignedRow[] = orphanExtraItems.map((it) => ({
    id: it.id,
    name: it.name,
    unit: it.unit,
    quantity: it.quantity,
    unitPrice: it.unit_price,
    totalPrice: it.total_price,
    brandNote: it.brand_note,
    itemType: "extra",
    quoteStatus: (it.quote_status as QuoteStatus | null) ?? null,
    contractSignedAt: it.contract_signed_at,
    contractNote: it.contract_note,
  }));

  // 舊資料相容:從舊日誌 jsonb 蒐集合約外/未簽約(只有舊資料才會有)
  const legacyExtraRows: LegacyExtraRow[] = [];
  const legacyUnsignedRows: LegacyUnsignedRow[] = [];
  // 跨所有日誌的照片,日期前綴附在 caption 上,給 PhotoGallery+Lightbox 用
  const allPhotos: GalleryPhoto[] = [];
  for (const log of allLogs) {
    for (const e of (log.extra_items ?? []) as DailyLogExtraItem[]) {
      legacyExtraRows.push({ ...e, log_id: log.id, log_date: log.log_date });
    }
    for (const u of (log.unsigned_items ?? []) as DailyLogUnsignedItem[]) {
      legacyUnsignedRows.push({ ...u, log_id: log.id, log_date: log.log_date });
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

  // 樹狀工項清單只顯示合約內(section/item/spec/manual);extra/unsigned 用各自區塊顯示
  const contractItems = items.filter(
    (it) => it.item_type !== "extra" && it.item_type !== "unsigned",
  );
  const treeItems: TreeItem[] = contractItems.map((it) => ({
    id: it.id,
    parentId: it.parent_id,
    depth: it.depth,
    itemType: it.item_type as TreeItem["itemType"],
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
          {(actor?.role === "site_supervisor" || actor?.role === "owner" || actor?.role === "office_staff") && (
            <CaseQrCodeButton caseId={c.id} caseName={c.name} />
          )}
          {canEditWorkItems && (
            <>
              {/* 編輯 — 手機 icon-only，桌機顯示文字 */}
              <Button
                asChild
                size="sm"
                variant="outline"
                className="border-[#E0DCD6] size-9 sm:h-9 sm:w-auto sm:px-4"
                title="編輯案件"
              >
                <Link href={`/cases/${id}/edit`}>
                  <PencilIcon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">編輯</span>
                </Link>
              </Button>
              <DeleteCaseButton
                caseId={c.id}
                caseName={c.name}
                workItemCount={items.length}
              />
              <Button
                asChild
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Link href={`/cases/${id}/import`}>匯入工項</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 匯入資訊 — 工項總數只算 leaf(item/spec/manual),不算 section 分類層 */}
      {(() => {
        const leafCount = contractItems.filter(
          (it) => it.item_type !== "section",
        ).length;
        return (
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-5">
            <Stat
              label="工項總數"
              value={leafCount}
              accent={leafCount > 0}
            />
            <Stat
              label="已登記日誌"
              value={allLogs.length}
              accent={allLogs.length > 0}
            />
            <Stat
              label="追加合約"
              value={contractsForUI.length}
              accent={contractsForUI.length > 0}
            />
            <Stat
              label="未簽約項目"
              value={unsignedItems.length}
              accent={unsignedItems.length > 0}
            />
          </div>
        );
      })()}

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
          {canEditWorkItems && (
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
          )}
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

      {/* 工地出勤 — 近 14 天打卡時間軸(migration-2.21) */}
      <div className="mt-10 mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-primary md:text-xl">
          工地出勤
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            近 14 天 · {timelineEvents.length} 筆
          </span>
        </h2>
        <Link
          href={`/reports/attendance?case=${c.id}`}
          className="text-sm text-accent underline-offset-2 hover:underline"
        >
          完整出勤報表 →
        </Link>
      </div>
      <AttendanceTimeline events={timelineEvents} showUser showCase={false} emptyText="近 14 天無打卡紀錄" />

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

      {/* 追加合約 — 以「合約」為單位呈現(migration-2.16 後),
          每份合約可包多筆工項,有自己的 bundle 優惠價 */}
      <ExtraContractsSection
        contracts={contractsForUI}
        progress={progress}
        caseId={c.id}
        editable={canEditWorkItems}
      />

      {/* 未簽約施工內容 — 案件級工項,可補報價、多筆打包成追加合約 */}
      <ExtraUnsignedSection
        kind="unsigned"
        rows={unsignedItems}
        progress={progress}
        caseId={c.id}
        editable={canEditWorkItems}
      />

      {/* 罕見路徑:沒掛合約的 extra 工項(理論上 migration-2.16 已全部搬完);
          仍顯示舊版區塊讓 office 補綁,但通常為 0 筆 */}
      {orphanExtraRows.length > 0 && (
        <ExtraUnsignedSection
          kind="extra"
          rows={orphanExtraRows}
          progress={progress}
          caseId={c.id}
          editable={canEditWorkItems}
        />
      )}

      {/* 舊資料相容:來自舊日誌的 jsonb 合約外/未簽約清單,只在還有舊資料時顯示 */}
      {legacyExtraRows.length > 0 && (
        <>
          <div className="mt-10 mb-4 flex items-center justify-between">
            <h2 className="text-base font-medium text-muted-foreground">
              （舊資料）日誌登記的合約外項目
              <span className="ml-2 text-xs">
                共 {legacyExtraRows.length} 筆 — 來自升等前的日誌欄位
              </span>
            </h2>
          </div>
          <LegacyAggregateTable
            rows={legacyExtraRows}
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
        </>
      )}

      {legacyUnsignedRows.length > 0 && (
        <>
          <div className="mt-10 mb-4 flex items-center justify-between">
            <h2 className="text-base font-medium text-muted-foreground">
              （舊資料）日誌登記的未簽約項目
              <span className="ml-2 text-xs">
                共 {legacyUnsignedRows.length} 筆 — 來自升等前的日誌欄位
              </span>
            </h2>
          </div>
          <LegacyAggregateTable
            rows={legacyUnsignedRows}
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
        </>
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

type AggregateCol<T> = {
  key: keyof T & string;
  label: string;
  align?: "left" | "right";
};

function LegacyAggregateTable<
  T extends { log_id: string; log_date: string },
>({
  rows,
  cols,
}: {
  rows: T[];
  cols: AggregateCol<T>[];
}) {
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
