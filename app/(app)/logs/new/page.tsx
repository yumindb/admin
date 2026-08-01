import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/db/fetch-all";
import { NewLogForm, type CaseOption, type PendingFieldReport } from "./new-log-form";
import type { PickerItem } from "@/components/work-items-picker";
import { computeWorkItemAggregates } from "@/lib/work-item-aggregates";
import {
  computeManpowerByCase,
  computeDayLaborByCase,
  computeSubcontractorTotalsByCase,
  computeMachineTotalsByCase,
  parseWeather,
  todayLocalDate,
} from "@/lib/daily-log";
import { formatDateTW } from "@/lib/datetime";
import type { DailyLog, DailyLogWorkItem, FieldReport } from "@/lib/types";
import { getSignedUrls } from "@/lib/supabase/storage";
import { emailToUsername } from "@/lib/auth/username";

export default async function NewLogPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string; from?: string }>;
}) {
  const { case: presetCaseId, from: fromLogId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user!.id)
    .maybeSingle();
  if (profile?.role !== "site_supervisor" && profile?.role !== "owner") {
    redirect("/logs");
  }

  const { data: cases } = await supabase
    .from("cases")
    .select("id, name, code, company, location, expected_end")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const caseIds = (cases ?? []).map((c) => c.id);
  // fetchAllRows:真實標單單案 1200+ 工項,跨案加總必超 PostgREST 1000 筆上限
  const { data: workItems } = caseIds.length
    ? await fetchAllRows((from, to) =>
        supabase
          .from("case_work_items")
          .select(
            "id, case_id, parent_id, depth, item_type, tender_code, name, unit, quantity, sort_path"
          )
          .in("case_id", caseIds)
          .eq("skipped", false)
          .order("sort_path", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      )
    : { data: [] };

  // 把每案的 case_work_items 拆兩組:合約內(section/item/spec/manual)、未簽約(unsigned)
  // migration-2.16 起,合約外(extra)已升等成「追加合約」由辦公室助理在案件總覽操作,
  // 不再出現在主任填日誌的 picker。原本 extraWorkItems 路徑保留為空陣列以維持 prop 結構。
  const groupedContract = new Map<string, PickerItem[]>();
  const groupedUnsigned = new Map<string, PickerItem[]>();
  for (const w of workItems ?? []) {
    const baseType = w.item_type as
      | "section" | "item" | "spec" | "manual" | "extra" | "unsigned";
    // extra 工項已歸到追加合約,日誌不再顯示 — 直接略過
    if (baseType === "extra") continue;
    // unsigned 在 picker 視作 'item'(扁平、可勾選),只有合約內保留原 type
    const pickerType: PickerItem["itemType"] =
      baseType === "unsigned" ? "item" : baseType;
    const item: PickerItem = {
      id: w.id as string,
      parentId:
        baseType === "unsigned" ? null : (w.parent_id as string | null),
      depth: baseType === "unsigned" ? 0 : (w.depth as number),
      itemType: pickerType,
      tenderCode: w.tender_code as string | null,
      name: w.name as string,
      unit: w.unit as string | null,
      totalQuantity: w.quantity as number | null,
    };
    const caseId = w.case_id as string;
    if (baseType === "unsigned") {
      const arr = groupedUnsigned.get(caseId) ?? [];
      arr.push(item);
      groupedUnsigned.set(caseId, arr);
    } else {
      const arr = groupedContract.get(caseId) ?? [];
      arr.push(item);
      groupedContract.set(caseId, arr);
    }
  }

  const caseOptions: CaseOption[] = (cases ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    code: c.code as string | null,
    company: c.company as string,
    location: c.location as string | null,
    expectedEnd: c.expected_end as string | null,
    workItems: groupedContract.get(c.id as string) ?? [],
    extraWorkItems: [], // legacy prop，保留結構；追加合約已不在日誌 picker 出現
    unsignedWorkItems: groupedUnsigned.get(c.id as string) ?? [],
  }));

  // 撈這些案件的所有 daily_logs:
  // 1. case_id + log_date → 算「該案件當天第幾份」(所有狀態都算,避免序號跳號)
  // 2. submitted/approved 的 work_items → 算各工項「已累計」+ 鎖定 qty_mode
  const { data: existingLogs } = caseIds.length
    ? await fetchAllRows((from, to) =>
        supabase
          .from("daily_logs")
          .select("id, case_id, log_date, created_at, work_items, manpower, status")
          .in("case_id", caseIds)
          .order("id", { ascending: true })
          .range(from, to),
      )
    : { data: [] };

  const dayLogCounts: Record<string, Record<string, number>> = {};
  for (const l of existingLogs ?? []) {
    const cid = l.case_id as string;
    const ld = l.log_date as string;
    dayLogCounts[cid] ??= {};
    dayLogCounts[cid][ld] = (dayLogCounts[cid][ld] ?? 0) + 1;
  }

  const priorRows = (existingLogs ?? []).filter(
    (l) => l.status === "submitted" || l.status === "approved",
  );
  const priorLogs = priorRows.map((l) => ({
    id: l.id as string,
    case_id: l.case_id as string,
    created_at: l.created_at as string,
    work_items: (l.work_items as DailyLogWorkItem[] | null) ?? [],
  }));
  const aggregates = computeWorkItemAggregates(priorLogs);
  const priorManpowerByCase = computeManpowerByCase(
    priorRows.map((l) => ({
      id: l.id as string,
      case_id: l.case_id as string,
      today_total: (l.manpower as { today_total?: number } | null)?.today_total,
    })),
  );
  const priorDayLaborByCase = computeDayLaborByCase(
    priorRows.map((l) => ({
      id: l.id as string,
      case_id: l.case_id as string,
      day_labor: (l.manpower as { day_labor?: number } | null)?.day_labor,
    })),
  );
  const priorSubcontractorByCase = computeSubcontractorTotalsByCase(
    priorRows.map((l) => ({
      id: l.id as string,
      case_id: l.case_id as string,
      subcontractors:
        (l.manpower as { subcontractors?: { trade?: string; today?: number }[] } | null)
          ?.subcontractors ?? [],
    })),
  );
  const priorMachineByCase = computeMachineTotalsByCase(
    priorRows.map((l) => ({
      id: l.id as string,
      case_id: l.case_id as string,
      machines:
        (l.manpower as { machines?: { name?: string; today?: number }[] } | null)
          ?.machines ?? [],
    })),
  );

  // 撈這些案件的 pending 現場回報,主任填日誌時可以勾選整合進來
  const { data: reportRows } = caseIds.length
    ? await supabase
        .from("field_reports")
        .select("id, case_id, note, photos, created_at, author:profiles!author_id(full_name)")
        .in("case_id", caseIds)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
    : { data: [] };

  type ReportRowWithAuthor = Pick<
    FieldReport,
    "id" | "case_id" | "note" | "photos" | "created_at"
  > & {
    author: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const pendingReportsByCase: Record<string, PendingFieldReport[]> = {};
  for (const row of (reportRows ?? []) as unknown as ReportRowWithAuthor[]) {
    const author = Array.isArray(row.author) ? row.author[0] : row.author;
    const list = pendingReportsByCase[row.case_id] ?? [];
    list.push({
      id: row.id,
      caseId: row.case_id,
      note: row.note ?? "",
      photos: row.photos ?? [],
      authorName: author?.full_name ?? "未命名",
      createdAt: row.created_at,
    });
    pendingReportsByCase[row.case_id] = list;
  }

  // Storage 已轉 private — 對待整合 reports 的照片 sign(主任勾選預覽用)
  // original_path(標註前原圖)一起簽:合併後若要重新標註,annotator 要載得出原圖
  const allReportPhotos: { path: string; original_path?: string }[] = [];
  for (const list of Object.values(pendingReportsByCase)) {
    for (const r of list) {
      for (const p of r.photos) allReportPhotos.push(p);
    }
  }
  if (allReportPhotos.length > 0) {
    const photoSignedMap = await getSignedUrls(
      "daily-photos",
      allReportPhotos.flatMap((p) =>
        p.original_path ? [p.path, p.original_path] : [p.path],
      ),
    );
    for (const list of Object.values(pendingReportsByCase)) {
      for (const r of list) {
        r.photos = r.photos.map((p) => ({
          ...p,
          path: photoSignedMap.get(p.path) ?? p.path,
          ...(p.original_path
            ? { original_path: photoSignedMap.get(p.original_path) ?? p.original_path }
            : {}),
        }));
      }
    }
  }

  // 「複製日誌」:當帶 ?from=<id> 時撈來源 log,預填工項 / 外包 / 機具 / 天氣 / 案件,
  // 但不複製照片 / 備註 / 簽名;日期帶今天。RLS 自動擋越權讀取(讀不到就視為沒這份)。
  let prefilledFrom: { sourceLogDate: string } | null = null;
  let cloneInitial:
    | NonNullable<Parameters<typeof NewLogForm>[0]["initial"]>
    | undefined = undefined;
  if (fromLogId) {
    const { data: src } = await supabase
      .from("daily_logs")
      .select("*")
      .eq("id", fromLogId)
      .maybeSingle();
    if (src) {
      const s = src as DailyLog;
      prefilledFrom = { sourceLogDate: s.log_date };
      // 台灣時區的今天 — server 在 Vercel(UTC)上 toISOString 會在台灣 00:00–07:59 拿到前一天
      const today = todayLocalDate();
      // 複製日誌時要把來源 work_items 依 item_type 拆三組(合約內 / 合約外 / 未簽約)
      // 用本批撈的 case_work_items 查表;查不到的當作合約內(dangling)
      const itemTypeBySrcId = new Map<string, string>();
      for (const w of workItems ?? []) {
        itemTypeBySrcId.set(w.id as string, w.item_type as string);
      }
      const srcWorkItems = (s.work_items ?? []) as DailyLogWorkItem[];
      const cloneContract: DailyLogWorkItem[] = [];
      const cloneExtra: DailyLogWorkItem[] = []; // 不會再被使用（extra 不在 picker），保留以維持 prop 結構
      const cloneUnsigned: DailyLogWorkItem[] = [];
      for (const w of srcWorkItems) {
        const t = itemTypeBySrcId.get(w.work_item_id);
        const v: DailyLogWorkItem = {
          work_item_id: w.work_item_id,
          qty: w.qty,
          qty_mode: w.qty_mode ?? "absolute",
          note: w.note ?? "",
        };
        // extra 已歸到追加合約,複製日誌時不帶過來(來源若有引用,留在 server-side 紀錄但不 prefill picker)
        if (t === "extra") continue;
        if (t === "unsigned") cloneUnsigned.push(v);
        else cloneContract.push(v);
      }
      cloneInitial = {
        caseId: s.case_id,
        logDate: today,
        weather: parseWeather(s.weather),
        manpowerTodayTotal: 0,
        // 工別 / 機具:保留 trade / name,但「本日」清空(累計由 priorXxxByCase 自動算)
        subcontractors: (s.manpower?.subcontractors ?? []).map((x) => ({
          trade: x.trade,
        })),
        machines: (s.manpower?.machines ?? []).map((x) => ({ name: x.name })),
        // 工項:三組分別填入
        workItems: cloneContract,
        pickedExtra: cloneExtra,
        pickedUnsigned: cloneUnsigned,
        extraItems: [],
        unsignedItems: [],
        photos: [],
        vendorNotices: "",
        notes: "",
      };
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/logs" className="hover:text-accent">
          日誌
        </Link>
        <span className="mx-1.5">／</span>
        <span>{prefilledFrom ? "複製日誌" : "新日誌"}</span>
      </nav>
      <h1 className="mb-3 text-2xl font-semibold text-primary md:text-3xl">
        {prefilledFrom ? "複製日誌" : "新日誌"}
      </h1>

      {prefilledFrom && (
        <div className="mb-7 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5 text-sm text-[#92400E] md:px-4 md:py-3">
          從 {formatDateTW(prefilledFrom.sourceLogDate)} 的日誌複製。
          請檢查工項數量與外包人員後再送出。
          照片、備註、簽名不會帶過來，日期已帶今天。
        </div>
      )}
      {!prefilledFrom && <div className="mb-7" />}

      <NewLogForm
        cases={caseOptions}
        presetCaseId={presetCaseId}
        currentUserName={profile?.full_name ?? emailToUsername(user?.email) ?? "未命名使用者"}
        dayLogCounts={dayLogCounts}
        priorAggregates={aggregates}
        priorManpowerByCase={priorManpowerByCase}
        priorDayLaborByCase={priorDayLaborByCase}
        priorSubcontractorByCase={priorSubcontractorByCase}
        priorMachineByCase={priorMachineByCase}
        pendingReportsByCase={pendingReportsByCase}
        initial={cloneInitial}
        skipDraftRestore={!!prefilledFrom}
      />
    </div>
  );
}
