import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/db/fetch-all";
import { getSignedUrls } from "@/lib/supabase/storage";
import { computeWorkItemAggregates } from "@/lib/work-item-aggregates";
import {
  computeManpowerByCase,
  computeDayLaborByCase,
  computeSubcontractorTotalsByCase,
  computeMachineTotalsByCase,
} from "@/lib/daily-log";
import type { PickerItem } from "@/components/work-items-picker";
import type { WorkItemAggregate } from "@/lib/work-item-aggregates";
import type { DailyLogWorkItem, FieldReport, FieldReportPhoto } from "@/lib/types";

/**
 * 日誌表單「單一案件」所需的全部資料。
 *
 * 為什麼是單一案件:原本 /logs/new 與編輯頁一次撈「所有 active 案件」的工項
 * (真實標單一案 1200+ 筆,多案就上萬)加上「所有案件的全部日誌」(含 work_items
 * jsonb,隨時間無上限成長),整包還 serialize 進 client component 的 props。
 * 主任在工地用手機開表單光下載就要等 — 2026-08 業主回報「按一下都很慢」的主因。
 * 現在只撈當下選中的那一案,換案時再用 server action 補抓(見 case-data-actions.ts)。
 */
export type CaseFormData = {
  /** 合約內工項(section/item/spec/manual)— picker 樹狀顯示 */
  workItems: PickerItem[];
  /** 未簽約工項 — picker 扁平顯示 */
  unsignedWorkItems: PickerItem[];
  /** 各工項的歷史累計與鎖定模式(submitted/approved 日誌算出) */
  aggregates: Record<string, WorkItemAggregate>;
  /** 之前已累計的出工人次 */
  priorManpower: number;
  /** 之前已累計的點工人次(與出工分開算,不相加) */
  priorDayLabor: number;
  /** 工別正規化名 → 之前累計人次 */
  priorSubcontractor: Record<string, number>;
  /** 機具正規化名 → 之前累計使用數量 */
  priorMachine: Record<string, number>;
  /** log_date → 該案當日已有幾份日誌(算「當日第 NN 份」用,所有狀態都算) */
  dayLogCounts: Record<string, number>;
  /** 待整合的現場回報(pending),照片已轉 signed URL */
  pendingReports: PendingReport[];
};

export type PendingReport = {
  id: string;
  caseId: string;
  note: string;
  photos: FieldReportPhoto[];
  authorName: string;
  createdAt: string;
};

type Client = SupabaseClient;

/**
 * 案件選單上「N 個工項可填」用的數字。
 *
 * 只問 count(head-only,不回任何 row),一次全部平行發 — 比起把所有案件的
 * case_work_items 整包撈回來只為了數長度,省掉的是上萬列的傳輸與解析。
 */
export async function loadCaseWorkItemCounts(
  supabase: Client,
  caseIds: string[],
): Promise<Record<string, number>> {
  if (caseIds.length === 0) return {};
  const results = await Promise.all(
    caseIds.map((id) =>
      supabase
        .from("case_work_items")
        .select("id", { count: "exact", head: true })
        .eq("case_id", id)
        .eq("skipped", false)
        // 合約外(追加合約)與未簽約不在「合約內工項」的計數裡 — 與 picker 一致
        .not("item_type", "in", "(extra,unsigned)"),
    ),
  );
  const map: Record<string, number> = {};
  caseIds.forEach((id, i) => {
    map[id] = results[i].count ?? 0;
  });
  return map;
}

/**
 * @param excludeLogId 編輯既有日誌時傳自己的 id — 累計要排除自己,否則會雙倍計算
 */
export async function loadCaseFormData(
  supabase: Client,
  caseId: string,
  excludeLogId?: string,
): Promise<CaseFormData> {
  // 三組查詢彼此無關 → 平行
  const [workItemsRes, logsRes, reportsRes] = await Promise.all([
    // fetchAllRows:真實標單單案 1200+ 工項,超過 PostgREST 1000 筆上限會被默默截斷
    fetchAllRows((from, to) =>
      supabase
        .from("case_work_items")
        .select(
          "id, case_id, parent_id, depth, item_type, tender_code, name, unit, quantity, sort_path",
        )
        .eq("case_id", caseId)
        .eq("skipped", false)
        .order("sort_path", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("daily_logs")
        .select("id, case_id, log_date, created_at, work_items, manpower, status")
        .eq("case_id", caseId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("field_reports")
      .select(
        "id, case_id, note, photos, created_at, author:profiles!author_id(full_name)",
      )
      .eq("case_id", caseId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  // ---- 工項:拆合約內 / 未簽約 ----
  // migration-2.16 起 extra(合約外)已升等成「追加合約」,不再出現在日誌 picker。
  const workItems: PickerItem[] = [];
  const unsignedWorkItems: PickerItem[] = [];
  for (const w of workItemsRes.data ?? []) {
    const baseType = w.item_type as
      | "section" | "item" | "spec" | "manual" | "extra" | "unsigned";
    if (baseType === "extra") continue;
    const item: PickerItem = {
      id: w.id as string,
      parentId: baseType === "unsigned" ? null : (w.parent_id as string | null),
      depth: baseType === "unsigned" ? 0 : (w.depth as number),
      // unsigned 在 picker 視作 'item'(扁平、可勾選),只有合約內保留原 type
      itemType: baseType === "unsigned" ? "item" : baseType,
      tenderCode: w.tender_code as string | null,
      name: w.name as string,
      unit: w.unit as string | null,
      totalQuantity: w.quantity as number | null,
    };
    if (baseType === "unsigned") unsignedWorkItems.push(item);
    else workItems.push(item);
  }

  // ---- 日誌:當日序號 + 各種累計 ----
  const allLogs = logsRes.data ?? [];
  const dayLogCounts: Record<string, number> = {};
  for (const l of allLogs) {
    const ld = l.log_date as string;
    dayLogCounts[ld] = (dayLogCounts[ld] ?? 0) + 1;
  }

  const priorRows = allLogs.filter(
    (l) => l.status === "submitted" || l.status === "approved",
  );
  const base = priorRows.map((l) => ({
    id: l.id as string,
    case_id: l.case_id as string,
  }));

  const aggregates = computeWorkItemAggregates(
    priorRows.map((l) => ({
      id: l.id as string,
      case_id: l.case_id as string,
      created_at: l.created_at as string,
      work_items: (l.work_items as DailyLogWorkItem[] | null) ?? [],
    })),
    excludeLogId,
  );
  const manpower = computeManpowerByCase(
    priorRows.map((l, i) => ({
      ...base[i],
      today_total: (l.manpower as { today_total?: number } | null)?.today_total,
    })),
    excludeLogId,
  );
  const dayLabor = computeDayLaborByCase(
    priorRows.map((l, i) => ({
      ...base[i],
      day_labor: (l.manpower as { day_labor?: number } | null)?.day_labor,
    })),
    excludeLogId,
  );
  const subcontractor = computeSubcontractorTotalsByCase(
    priorRows.map((l, i) => ({
      ...base[i],
      subcontractors:
        (l.manpower as { subcontractors?: { trade?: string; today?: number }[] } | null)
          ?.subcontractors ?? [],
    })),
    excludeLogId,
  );
  const machine = computeMachineTotalsByCase(
    priorRows.map((l, i) => ({
      ...base[i],
      machines:
        (l.manpower as { machines?: { name?: string; today?: number }[] } | null)
          ?.machines ?? [],
    })),
    excludeLogId,
  );

  // ---- 待整合的現場回報 ----
  type ReportRowWithAuthor = Pick<
    FieldReport,
    "id" | "case_id" | "note" | "photos" | "created_at"
  > & {
    author: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const pendingReports: PendingReport[] = [];
  for (const row of (reportsRes.data ?? []) as unknown as ReportRowWithAuthor[]) {
    const author = Array.isArray(row.author) ? row.author[0] : row.author;
    pendingReports.push({
      id: row.id,
      caseId: row.case_id,
      note: row.note ?? "",
      photos: row.photos ?? [],
      authorName: author?.full_name ?? "未命名",
      createdAt: row.created_at,
    });
  }

  // Storage 已轉 private → signed URL。original_path(標註前原圖)一起簽:
  // 合併後若要重新標註,annotator 要載得出原圖。
  const allPhotos = pendingReports.flatMap((r) => r.photos);
  if (allPhotos.length > 0) {
    const signed = await getSignedUrls(
      "daily-photos",
      allPhotos.flatMap((p) =>
        p.original_path ? [p.path, p.original_path] : [p.path],
      ),
    );
    for (const r of pendingReports) {
      r.photos = r.photos.map((p) => ({
        ...p,
        path: signed.get(p.path) ?? p.path,
        ...(p.original_path
          ? { original_path: signed.get(p.original_path) ?? p.original_path }
          : {}),
      }));
    }
  }

  return {
    workItems,
    unsignedWorkItems,
    aggregates: aggregates[caseId] ?? {},
    priorManpower: manpower[caseId] ?? 0,
    priorDayLabor: dayLabor[caseId] ?? 0,
    priorSubcontractor: subcontractor[caseId] ?? {},
    priorMachine: machine[caseId] ?? {},
    dayLogCounts,
    pendingReports,
  };
}
