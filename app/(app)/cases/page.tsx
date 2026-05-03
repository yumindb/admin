import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { normalizeLogPhotos } from "@/lib/daily-log";
import { getSignedUrls } from "@/lib/supabase/storage";
import { Button } from "@/components/ui/button";
import { CasesOverviewList } from "@/components/cases-overview-list";
import { isCaseBehind, type CaseStats } from "@/lib/case-progress";
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

export default async function CasesOverviewPage() {
  const supabase = await createClient();

  const [
    { data: cases, error },
    { data: workItems },
    { data: logs },
  ] = await Promise.all([
    supabase.from("cases").select("*"),
    supabase
      .from("case_work_items")
      .select("id, case_id, item_type, quantity"),
    supabase
      .from("daily_logs")
      .select(
        "case_id, status, work_items, extra_items, unsigned_items, photos, log_date",
      )
      .in("status", ["submitted", "approved"])
      .order("log_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

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

  // 工項數(僅葉節點:item / spec)
  for (const it of allItems) {
    const s = statsByCase.get(it.case_id);
    if (!s) continue;
    if (it.item_type === "item" || it.item_type === "spec") {
      s.itemCount += 1;
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
        <Button
          asChild
          size="lg"
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link href="/cases/new">+ 開新案</Link>
        </Button>
      </div>

      <CasesKpiBar kpis={kpis} />

      {error && (
        <p className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
          載入失敗:{error.message}
        </p>
      )}

      <CasesOverviewList cases={allCases} statsMap={statsRecord} />
    </div>
  );
}
