import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewLogForm, type CaseOption, type PendingFieldReport } from "../../new/new-log-form";
import { NextStepHint } from "@/components/next-step-hint";
import type { PickerItem } from "@/components/work-items-picker";
import type { DailyLog, DailyLogWorkItem, FieldReport, LogApproval } from "@/lib/types";
import {
  parseWeather,
  computeManpowerByCase,
  computeSubcontractorTotalsByCase,
  computeMachineTotalsByCase,
  normalizeLogPhotos,
} from "@/lib/daily-log";
import { formatTW, formatDateTW } from "@/lib/datetime";
import { computeWorkItemAggregates } from "@/lib/work-item-aggregates";
import { getSignedUrls } from "@/lib/supabase/storage";
import { emailToUsername } from "@/lib/auth/username";

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
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user!.id)
    .maybeSingle();

  // 編輯權限分三條:
  //   1. supervisor 本人 + draft/rejected → 「主流程編輯」(會重新送出 + 簽名)
  //   2. supervisor 本人 + submitted     → 「送出後編輯」(silent, audit-only)
  //   3. office_staff / owner + submitted/rejected → 「送出後編輯」(silent, audit-only)
  // approved 一律不可編輯。
  if (l.status === "approved") redirect(`/logs/${id}`);

  const role = profile?.role ?? null;
  const isSelf = l.supervisor_id === user!.id;

  let editMode: "classic" | "post-submission";
  if (role === "site_supervisor" && isSelf && (l.status === "draft" || l.status === "rejected")) {
    editMode = "classic";
  } else if (
    (role === "site_supervisor" && isSelf && l.status === "submitted") ||
    (role === "office_staff" && (l.status === "submitted" || l.status === "rejected")) ||
    (role === "owner" && (l.status === "submitted" || l.status === "rejected"))
  ) {
    editMode = "post-submission";
  } else {
    redirect(`/logs/${id}`);
  }

  const { data: cases } = await supabase
    .from("cases")
    .select("id, name, code, company, location, expected_end")
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

  // 與 /logs/new 同樣分組:合約內、未簽約。extra(追加合約)不在日誌出現,跳過。
  const groupedContract = new Map<string, PickerItem[]>();
  const groupedUnsigned = new Map<string, PickerItem[]>();
  // 同時建一個 work_item_id → item_type 的查表,讓下方把 log 的 work_items 拆組
  const itemTypeById = new Map<string, string>();
  for (const w of workItems ?? []) {
    const baseType = w.item_type as
      | "section" | "item" | "spec" | "manual" | "extra" | "unsigned";
    itemTypeById.set(w.id as string, baseType);
    if (baseType === "extra") continue; // 追加合約已不在日誌 picker 出現
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
    extraWorkItems: [], // 追加合約已不在日誌 picker 出現，保留結構
    unsignedWorkItems: groupedUnsigned.get(c.id as string) ?? [],
  }));

  // 把當前 log 的 work_items 依 item_type 拆組:合約內、未簽約、保留的 extra 引用。
  // extra(追加合約)的 historical 引用仍保留在 server 紀錄,但 picker 不顯示;
  // 用 preservedExtraWorkItems 帶回去儲存時原樣保留,讓進度與審計不丟失。
  const logWorkItems = (l.work_items ?? []) as DailyLogWorkItem[];
  const initialContract: DailyLogWorkItem[] = [];
  const initialUnsigned: DailyLogWorkItem[] = [];
  const initialPreservedExtra: DailyLogWorkItem[] = [];
  for (const w of logWorkItems) {
    const t = itemTypeById.get(w.work_item_id);
    if (t === "extra") {
      initialPreservedExtra.push(w);
      continue;
    }
    if (t === "unsigned") initialUnsigned.push(w);
    else initialContract.push(w);   // 包含找不到對應 case_work_items 的 dangling 引用
  }

  // 計算這份日誌在當案當日是第幾份(編輯時序號不變)
  const { count: dayCount } = await supabase
    .from("daily_logs")
    .select("id", { count: "exact", head: true })
    .eq("case_id", l.case_id)
    .eq("log_date", l.log_date)
    .lte("created_at", l.created_at);
  const currentDaySeq = dayCount ?? 1;

  // 撈所有 submitted/approved 日誌的 work_items 算各工項已累計與模式鎖定;
  // 排除「自己」(編輯中的這份)避免重複計算
  const { data: priorRows } = caseIds.length
    ? await supabase
        .from("daily_logs")
        .select("id, case_id, created_at, work_items, manpower, status")
        .in("case_id", caseIds)
        .in("status", ["submitted", "approved"])
    : { data: [] };
  const priorLogs = (priorRows ?? []).map((r) => ({
    id: r.id as string,
    case_id: r.case_id as string,
    created_at: r.created_at as string,
    work_items: (r.work_items as DailyLogWorkItem[] | null) ?? [],
  }));
  const aggregates = computeWorkItemAggregates(priorLogs, id);
  const priorManpowerByCase = computeManpowerByCase(
    (priorRows ?? []).map((r) => ({
      id: r.id as string,
      case_id: r.case_id as string,
      today_total: (r.manpower as { today_total?: number } | null)?.today_total,
    })),
    id,
  );
  const priorSubcontractorByCase = computeSubcontractorTotalsByCase(
    (priorRows ?? []).map((r) => ({
      id: r.id as string,
      case_id: r.case_id as string,
      subcontractors:
        (r.manpower as { subcontractors?: { trade?: string; today?: number }[] } | null)
          ?.subcontractors ?? [],
    })),
    id,
  );
  const priorMachineByCase = computeMachineTotalsByCase(
    (priorRows ?? []).map((r) => ({
      id: r.id as string,
      case_id: r.case_id as string,
      machines:
        (r.manpower as { machines?: { name?: string; today?: number }[] } | null)
          ?.machines ?? [],
    })),
    id,
  );

  // 若 log 為 rejected，撈最新一筆退回的 approval (含 approver 名稱) 用於頂部 banner
  type RejectionRow = LogApproval & {
    approver: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  let latestRejection: {
    comment: string;
    at: string;
    approverName: string;
  } | null = null;
  if (l.status === "rejected") {
    const { data: rejRows } = await supabase
      .from("log_approvals")
      .select(
        "id, log_id, stage, approver_id, decision, comment, signature_url, created_at, approver:profiles!approver_id(full_name)"
      )
      .eq("log_id", id)
      .eq("decision", "rejected")
      .order("created_at", { ascending: false })
      .limit(1);
    const r = (rejRows ?? [])[0] as RejectionRow | undefined;
    if (r) {
      const approver = Array.isArray(r.approver) ? r.approver[0] : r.approver;
      latestRejection = {
        comment: r.comment ?? "（沒有填寫原因）",
        at: r.created_at,
        approverName: approver?.full_name ?? "審核人",
      };
    }
  }

  // 撈該案件的 pending 現場回報
  const { data: reportRows } = await supabase
    .from("field_reports")
    .select("id, case_id, note, photos, created_at, author:profiles!author_id(full_name)")
    .eq("case_id", l.case_id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

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

  // Storage 已轉 private — 對 initial photos + 待整合 reports 的照片一次 sign
  const initialPhotos = normalizeLogPhotos(l.photos);
  const allReportPhotos: { path: string }[] = [];
  for (const list of Object.values(pendingReportsByCase)) {
    for (const r of list) {
      for (const p of r.photos) allReportPhotos.push(p);
    }
  }
  const photoSignedMap = await getSignedUrls(
    "daily-photos",
    [...initialPhotos.map((p) => p.path), ...allReportPhotos.map((p) => p.path)]
  );
  const initialPhotosSigned = initialPhotos.map((p) => ({
    ...p,
    path: photoSignedMap.get(p.path) ?? p.path,
  }));
  for (const list of Object.values(pendingReportsByCase)) {
    for (const r of list) {
      r.photos = r.photos.map((p) => ({
        ...p,
        path: photoSignedMap.get(p.path) ?? p.path,
      }));
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/logs" className="hover:text-accent">
          日誌
        </Link>
        <span className="mx-1.5">／</span>
        <Link href={`/logs/${id}`} className="hover:text-accent">
          {formatDateTW(l.log_date)}
        </Link>
        <span className="mx-1.5">／</span>
        <span>編輯</span>
      </nav>
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">編輯日誌</h1>
      {latestRejection && (
        <div className="mb-5 mt-3">
          <NextStepHint tone="warning" title="退回原因">
            <p className="whitespace-pre-line text-sm leading-relaxed">
              {latestRejection.comment}
            </p>
            <p className="mt-2 text-xs opacity-80">
              {latestRejection.approverName} ・ {formatTW(latestRejection.at)} 退回
            </p>
          </NextStepHint>
        </div>
      )}
      {editMode === "post-submission" && (
        <p className="mb-7 text-sm text-muted-foreground">
          此日誌已送出（{l.status === "rejected" ? "已退回" : "簽核中"}），這次的編輯會記錄誰在何時改了哪些欄位。若內容有變，簽核流程會自動退回到辦公室助理階段重新審核（不需要重新簽名）。已核定的日誌不開放編輯。
        </p>
      )}
      {editMode === "classic" && <div className="mb-7" />}

      <NewLogForm
        editMode={editMode}
        cases={caseOptions}
        currentUserName={profile?.full_name ?? emailToUsername(user?.email) ?? "未命名使用者"}
        logId={id}
        currentDaySeq={currentDaySeq}
        priorAggregates={aggregates}
        priorManpowerByCase={priorManpowerByCase}
        priorSubcontractorByCase={priorSubcontractorByCase}
        priorMachineByCase={priorMachineByCase}
        pendingReportsByCase={pendingReportsByCase}
        initial={{
          caseId: l.case_id,
          logDate: l.log_date,
          weather: parseWeather(l.weather),
          manpowerTodayTotal: l.manpower?.today_total ?? 0,
          subcontractors: l.manpower?.subcontractors ?? [],
          machines: l.manpower?.machines ?? [],
          workItems: initialContract,
          pickedExtra: [], // 追加合約已不在日誌 picker 出現
          pickedUnsigned: initialUnsigned,
          extraItems: l.extra_items ?? [],
          unsignedItems: l.unsigned_items ?? [],
          photos: initialPhotosSigned,
          vendorNotices: l.vendor_notices ?? "",
          notes: l.notes ?? "",
          preservedExtraWorkItems: initialPreservedExtra,
        }}
      />
    </div>
  );
}
