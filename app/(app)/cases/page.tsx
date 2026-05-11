import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { normalizeLogPhotos } from "@/lib/daily-log";
import { getSignedUrls } from "@/lib/supabase/storage";
import { Button } from "@/components/ui/button";
import { CasesOverviewList } from "@/components/cases-overview-list";
import { isCaseBehind, type CaseStats } from "@/lib/case-progress";
import { tryGetActor } from "@/lib/auth/require-role";
import {
  CasesKpiBar,
  type CasesKpis,
} from "@/components/cases-kpi-bar";
import type {
  Case,
  CaseWorkItem,
  DailyLog,
  DailyLogExtraItem,
  DailyLogUnsignedItem,
  DailyLogWorkItem,
  LogPhoto,
} from "@/lib/types";

const PHOTO_PREVIEW_MAX = 4;

type Search = Promise<{ all?: string }>;

export default async function CasesOverviewPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const params = await searchParams;
  const showAll = params.all === "1";

  const supabase = await createClient();
  const actor = await tryGetActor();
  const canCreateCase =
    actor?.role === "office_staff" || actor?.role === "owner";

  // 1) 案件:預設只 active + paused(進行中),showAll=1 才撈 closed
  //    closed 案件通常 90% 的列表時間都不需要看,排除掉就大幅減少後續日誌與工項的撈取量。
  let caseQuery = supabase.from("cases").select("*");
  if (!showAll) {
    caseQuery = caseQuery.in("status", ["active", "paused"]);
  }
  const { data: cases, error } = await caseQuery;
  const caseIds = (cases ?? []).map((c) => c.id as string);

  // 2) 工項 / 日誌只撈這些 case 的(進度需要全期日誌才能算累計完成量,不限時間)
  const [{ data: workItems }, { data: logs }] = caseIds.length
    ? await Promise.all([
        supabase
          .from("case_work_items")
          .select("id, case_id, item_type, quantity")
          .in("case_id", caseIds),
        supabase
          .from("daily_logs")
          .select(
            "case_id, status, work_items, extra_items, unsigned_items, photos, log_date",
          )
          .in("case_id", caseIds)
          .in("status", ["submitted", "approved"])
          .order("log_date", { ascending: false })
          .order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const allCases = (cases ?? []) as Case[];
  const allItems = (workItems ?? []) as Pick<
    CaseWorkItem,
    "id" | "case_id" | "item_type" | "quantity"
  >[];
  const allLogs = (logs ?? []) as Pick<
    DailyLog,
    | "case_id"
    | "status"
    | "work_items"
    | "extra_items"
    | "unsigned_items"
    | "photos"
    | "log_date"
  >[];

  const itemMetaById = new Map<string, (typeof allItems)[number]>();
  for (const it of allItems) itemMetaById.set(it.id, it);

  // 預先彙整每個案件的 stats
  const statsByCase = new Map<string, CaseStats>();
  const today = new Date();
  for (const c of allCases) {
    let startedDaysAgo: number | null = null;
    if (c.started_at) {
      const dt = new Date(c.started_at);
      if (!Number.isNaN(dt.getTime())) {
        const diff = (today.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24);
        startedDaysAgo = Math.floor(diff);
      }
    }
    statsByCase.set(c.id, {
      itemCount: 0,
      logCount: 0,
      progressPct: null,
      extraCount: 0,
      unsignedCount: 0,
      photos: [],
      photoTotal: 0,
      startedDaysAgo,
    });
  }

  // 工項數(僅葉節點:item / spec / manual)+ 案件級的合約外/未簽約計數
  for (const it of allItems) {
    const s = statsByCase.get(it.case_id);
    if (!s) continue;
    if (it.item_type === "item" || it.item_type === "spec" || it.item_type === "manual") {
      s.itemCount += 1;
    } else if (it.item_type === "extra") {
      s.extraCount += 1;
    } else if (it.item_type === "unsigned") {
      s.unsignedCount += 1;
    }
  }

  // 日誌數 / 已登記合約外 / 未簽約 / 累計完成數量(per work item)
  const doneQtyByItem = new Map<string, number>();
  // 額外:本週日誌數、本月超工筆數
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let weekLogCount = 0;
  let monthOvertimeCount = 0;

  for (const log of allLogs) {
    if (!log.case_id) continue;
    const s = statsByCase.get(log.case_id);
    if (!s) continue;
    s.logCount += 1;
    // 舊資料相容:legacy jsonb 內的 free-form 合約外/未簽約 也計入(避免雙重計算的話可省略)
    s.extraCount += ((log.extra_items ?? []) as DailyLogExtraItem[]).length;
    const unsigned = (log.unsigned_items ?? []) as DailyLogUnsignedItem[];
    s.unsignedCount += unsigned.length;

    // log_date 是 YYYY-MM-DD 字串;轉成 Date 比對
    const logDate = log.log_date ? new Date(log.log_date) : null;
    if (logDate && !Number.isNaN(logDate.getTime())) {
      if (logDate >= weekAgo) weekLogCount += 1;
      if (logDate >= monthStart) {
        for (const u of unsigned) {
          if (u.category === "點工" || u.category === "變更追加") {
            monthOvertimeCount += 1;
          }
        }
      }
    }

    // 收集照片
    const photos = normalizeLogPhotos(log.photos);
    if (photos.length > 0) {
      s.photoTotal += photos.length;
      if (s.photos.length < PHOTO_PREVIEW_MAX) {
        for (const p of photos) {
          if (s.photos.length >= PHOTO_PREVIEW_MAX) break;
          s.photos.push(p);
        }
      }
    }

    for (const w of (log.work_items ?? []) as DailyLogWorkItem[]) {
      const meta = itemMetaById.get(w.work_item_id);
      if (!meta) continue;
      const total = meta.quantity ?? 0;
      const inc = w.qty_mode === "percent" ? total * w.qty : w.qty;
      doneQtyByItem.set(
        w.work_item_id,
        (doneQtyByItem.get(w.work_item_id) ?? 0) + inc,
      );
    }
  }

  // 進度
  const pctSumByCase = new Map<string, number>();
  const pctCountByCase = new Map<string, number>();
  for (const it of allItems) {
    if (it.item_type !== "item" && it.item_type !== "spec") continue;
    const total = it.quantity ?? 0;
    const done = doneQtyByItem.get(it.id) ?? 0;
    const pct =
      total > 0 ? Math.min(1, done / total) : done > 0 ? 1 : 0;
    pctSumByCase.set(it.case_id, (pctSumByCase.get(it.case_id) ?? 0) + pct);
    pctCountByCase.set(
      it.case_id,
      (pctCountByCase.get(it.case_id) ?? 0) + 1,
    );
  }

  for (const [caseId, s] of statsByCase) {
    const sum = pctSumByCase.get(caseId) ?? 0;
    const count = pctCountByCase.get(caseId) ?? 0;
    if (count > 0) {
      s.progressPct = Math.round((sum / count) * 1000) / 10;
    } else {
      s.progressPct = null;
    }
  }

  // 取 signed URL
  const allPreviewPaths: string[] = [];
  for (const s of statsByCase.values()) {
    for (const p of s.photos) allPreviewPaths.push(p.path);
  }
  const previewSignedMap = await getSignedUrls(
    "daily-photos",
    allPreviewPaths
  );
  for (const s of statsByCase.values()) {
    s.photos = s.photos.map((p): LogPhoto => ({
      ...p,
      path: previewSignedMap.get(p.path) ?? p.path,
    }));
  }

  // KPI 計算
  const activeCases = allCases.filter((c) => c.status === "active");
  let behindCount = 0;
  for (const c of activeCases) {
    const s = statsByCase.get(c.id);
    if (s && isCaseBehind(s)) behindCount += 1;
  }
  const kpis: CasesKpis = {
    activeCount: activeCases.length,
    behindCount,
    weekLogCount,
    monthOvertimeCount,
  };

  const statsRecord: Record<string, CaseStats> = {};
  for (const [k, v] of statsByCase) statsRecord[k] = v;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">
            案件總覽
          </h1>
          <p className="mt-1.5 text-base text-muted-foreground">
            裕民工務目前管理的案件,可依公司／狀態篩選與排序
          </p>
        </div>
        {canCreateCase && (
          <Button
            asChild
            size="lg"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Link href="/cases/new">+ 開新案</Link>
          </Button>
        )}
      </div>

      <CasesKpiBar kpis={kpis} />

      <div className="mb-4 flex items-center justify-end gap-3 text-sm">
        {showAll ? (
          <>
            <span className="text-muted-foreground">顯示全部(含已結案)</span>
            <Link
              href="/cases"
              className="text-[#A07850] underline-offset-2 hover:underline"
            >
              只看進行中
            </Link>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">只看進行中</span>
            <Link
              href="/cases?all=1"
              className="text-[#A07850] underline-offset-2 hover:underline"
            >
              顯示全部(含已結案)
            </Link>
          </>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          載入失敗:{error.message}
        </p>
      )}

      <CasesOverviewList cases={allCases} statsMap={statsRecord} />
    </div>
  );
}
