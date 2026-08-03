import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { NewLogForm, type CaseOption } from "../../new/new-log-form";
import {
  loadCaseFormData,
  loadCaseWorkItemCounts,
  type CaseFormData,
} from "@/lib/logs/case-form-data";
import { NextStepHint } from "@/components/next-step-hint";
import type { DailyLog, DailyLogWorkItem, LogApproval } from "@/lib/types";
import { parseWeather, normalizeLogPhotos } from "@/lib/daily-log";
import { formatTW, formatDateTW } from "@/lib/datetime";
import { getSignedUrls } from "@/lib/supabase/storage";
import { emailToUsername } from "@/lib/auth/username";

export default async function EditLogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // layout 已載過(cache 命中);日誌本體與它無關,一起發
  const [actor, logRes] = await Promise.all([
    tryGetActor(),
    supabase.from("daily_logs").select("*").eq("id", id).maybeSingle(),
  ]);
  if (!actor) redirect("/login");
  if (!logRes.data) notFound();
  const l = logRes.data as DailyLog;

  // 編輯權限分三條:
  //   1. supervisor 本人 + draft/rejected → 「主流程編輯」(會重新送出 + 簽名)
  //   2. supervisor 本人 + submitted     → 「送出後編輯」(silent, audit-only)
  //   3. office_staff / owner + submitted/rejected → 「送出後編輯」
  //      (rejected 存檔即重新送審,見 saveLogAction 的 post_edit 分支)
  // approved 一律不可編輯。
  if (l.status === "approved") redirect(`/logs/${id}`);

  const role = actor.role;
  const isSelf = l.supervisor_id === actor.id;

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

  // 這份日誌的案件是固定的 → 只撈這一案的工項與累計(排除自己避免雙倍計算)。
  // 其餘查詢彼此無關,一起發。
  const [casesRes, caseFormData, dayCountRes, rejRes] = await Promise.all([
    supabase
      .from("cases")
      .select("id, name, code, company, location, expected_end")
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    loadCaseFormData(supabase, l.case_id, id),
    // 這份日誌在當案當日是第幾份(編輯時序號不變)
    supabase
      .from("daily_logs")
      .select("id", { count: "exact", head: true })
      .eq("case_id", l.case_id)
      .eq("log_date", l.log_date)
      .lte("created_at", l.created_at),
    // 已退回 → 撈最新一筆退回紀錄(含 approver 名稱)給頂部 banner
    l.status === "rejected"
      ? supabase
          .from("log_approvals")
          .select(
            "id, log_id, stage, approver_id, decision, comment, signature_url, created_at, approver:profiles!approver_id(full_name)"
          )
          .eq("log_id", id)
          .eq("decision", "rejected")
          .order("created_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
  ]);

  const cases = casesRes.data ?? [];
  // 案件已結案 / 暫停時不在 active 清單裡 — 補進來,否則編輯舊日誌會看不到自己的案件
  if (!cases.some((c) => c.id === l.case_id)) {
    const { data: ownCase } = await supabase
      .from("cases")
      .select("id, name, code, company, location, expected_end")
      .eq("id", l.case_id)
      .maybeSingle();
    if (ownCase) cases.unshift(ownCase);
  }
  const workItemCounts = await loadCaseWorkItemCounts(
    supabase,
    cases.map((c) => c.id as string),
  );
  const caseOptions: CaseOption[] = cases.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    code: c.code as string | null,
    company: c.company as string,
    location: c.location as string | null,
    expectedEnd: c.expected_end as string | null,
    workItemCount: workItemCounts[c.id as string] ?? 0,
  }));
  const caseData: Record<string, CaseFormData> = {
    [l.case_id]: caseFormData,
  };
  const currentDaySeq = dayCountRes.count ?? 1;

  // 把當前 log 的 work_items 拆組:合約內、未簽約、保留的 extra 引用。
  // extra(追加合約)的 historical 引用仍保留在 server 紀錄,但 picker 不顯示;
  // 用 preservedExtraWorkItems 帶回去儲存時原樣保留,讓進度與審計不丟失。
  const unsignedIds = new Set(caseFormData.unsignedWorkItems.map((w) => w.id));
  const contractIds = new Set(caseFormData.workItems.map((w) => w.id));
  const initialContract: DailyLogWorkItem[] = [];
  const initialUnsigned: DailyLogWorkItem[] = [];
  const initialPreservedExtra: DailyLogWorkItem[] = [];
  for (const w of (l.work_items ?? []) as DailyLogWorkItem[]) {
    if (unsignedIds.has(w.work_item_id)) initialUnsigned.push(w);
    else if (contractIds.has(w.work_item_id)) initialContract.push(w);
    // 兩邊都不在 → extra(追加合約)或已被刪掉的 dangling 引用,原樣保留不顯示
    else initialPreservedExtra.push(w);
  }

  type RejectionRow = LogApproval & {
    approver: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  let latestRejection: {
    comment: string;
    at: string;
    approverName: string;
  } | null = null;
  const rejRow = ((rejRes.data ?? []) as RejectionRow[])[0];
  if (rejRow) {
    const approver = Array.isArray(rejRow.approver)
      ? rejRow.approver[0]
      : rejRow.approver;
    latestRejection = {
      comment: rejRow.comment ?? "（沒有填寫原因）",
      at: rejRow.created_at,
      approverName: approver?.full_name ?? "審核人",
    };
  }

  // Storage 已轉 private — 對這份日誌的既有照片簽 URL。
  // original_path(標註前原圖)也要簽:重新標註時 annotator 要載得出原圖。
  // (待整合回報的照片已在 loadCaseFormData 內簽好)
  const initialPhotos = normalizeLogPhotos(l.photos);
  const photoSignedMap = await getSignedUrls(
    "daily-photos",
    initialPhotos.flatMap((p) =>
      p.original_path ? [p.path, p.original_path] : [p.path],
    ),
  );
  const initialPhotosSigned = initialPhotos.map((p) => ({
    ...p,
    path: photoSignedMap.get(p.path) ?? p.path,
    ...(p.original_path
      ? { original_path: photoSignedMap.get(p.original_path) ?? p.original_path }
      : {}),
  }));

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
          {l.status === "rejected"
            ? "這份日誌被退回了。改完按「存檔並重新送出」，會直接送回辦公室助理重新審核，通過後再交給核定人（不需要重新簽名）。這次的編輯會記錄誰在何時改了哪些欄位。"
            : "此日誌已送出（簽核中），這次的編輯會記錄誰在何時改了哪些欄位。若內容有變，簽核流程會自動退回到辦公室助理階段重新審核（不需要重新簽名）。已核定的日誌不開放編輯。"}
        </p>
      )}
      {editMode === "classic" && <div className="mb-7" />}

      <NewLogForm
        editMode={editMode}
        logStatus={l.status as "draft" | "rejected" | "submitted"}
        cases={caseOptions}
        currentUserName={actor.fullName ?? emailToUsername(actor.email ?? undefined) ?? "未命名使用者"}
        logId={id}
        currentDaySeq={currentDaySeq}
        caseData={caseData}
        initial={{
          caseId: l.case_id,
          logDate: l.log_date,
          weather: parseWeather(l.weather),
          manpowerTodayTotal: l.manpower?.today_total ?? 0,
          manpowerDayLabor: l.manpower?.day_labor ?? 0,
          manpowerDayLaborNote: l.manpower?.day_labor_note ?? "",
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
