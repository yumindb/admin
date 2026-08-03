import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { NewLogForm, type CaseOption } from "./new-log-form";
import {
  loadCaseFormData,
  loadCaseWorkItemCounts,
  type CaseFormData,
} from "@/lib/logs/case-form-data";
import { parseWeather, todayLocalDate } from "@/lib/daily-log";
import { formatDateTW } from "@/lib/datetime";
import type { DailyLog, DailyLogWorkItem } from "@/lib/types";
import { emailToUsername } from "@/lib/auth/username";

export default async function NewLogPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string; from?: string }>;
}) {
  const { case: presetCaseId, from: fromLogId } = await searchParams;
  const supabase = await createClient();
  // layout 已載過(cache 命中)
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "site_supervisor" && actor.role !== "owner") {
    redirect("/logs");
  }

  // 案件清單只帶選單需要的欄位 — 工項與累計等選定案件後才撈(見 lib/logs/case-form-data.ts)
  const [casesRes, srcRes] = await Promise.all([
    supabase
      .from("cases")
      .select("id, name, code, company, location, expected_end")
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    // 「複製日誌」:?from=<id> 時撈來源 log 預填。RLS 自動擋越權讀取。
    fromLogId
      ? supabase.from("daily_logs").select("*").eq("id", fromLogId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const cases = casesRes.data ?? [];
  const src = srcRes.data as DailyLog | null;

  // 一開始就選中的案件:網址帶的 ?case=,或複製來源日誌的案件
  const initialCaseId =
    (presetCaseId && cases.some((c) => c.id === presetCaseId)
      ? presetCaseId
      : null) ?? (src?.case_id ?? null);

  const [workItemCounts, initialCaseData] = await Promise.all([
    loadCaseWorkItemCounts(supabase, cases.map((c) => c.id as string)),
    initialCaseId
      ? loadCaseFormData(supabase, initialCaseId)
      : Promise.resolve(null),
  ]);

  const caseOptions: CaseOption[] = cases.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    code: c.code as string | null,
    company: c.company as string,
    location: c.location as string | null,
    expectedEnd: c.expected_end as string | null,
    workItemCount: workItemCounts[c.id as string] ?? 0,
  }));

  const caseData: Record<string, CaseFormData> =
    initialCaseId && initialCaseData ? { [initialCaseId]: initialCaseData } : {};

  // 「複製日誌」:預填工項 / 外包 / 機具 / 天氣 / 案件,
  // 但不複製照片 / 備註 / 簽名;日期帶今天。
  let prefilledFrom: { sourceLogDate: string } | null = null;
  let cloneInitial:
    | NonNullable<Parameters<typeof NewLogForm>[0]["initial"]>
    | undefined = undefined;
  if (src) {
    prefilledFrom = { sourceLogDate: src.log_date };
    // 台灣時區的今天 — server 在 Vercel(UTC)上 toISOString 會在台灣 00:00–07:59 拿到前一天
    const today = todayLocalDate();
    // 來源 work_items 依 item_type 拆組:用該案已載好的工項查表,查不到的當合約內(dangling)
    const unsignedIds = new Set(
      (initialCaseData?.unsignedWorkItems ?? []).map((w) => w.id),
    );
    const contractIds = new Set(
      (initialCaseData?.workItems ?? []).map((w) => w.id),
    );
    const cloneContract: DailyLogWorkItem[] = [];
    const cloneUnsigned: DailyLogWorkItem[] = [];
    for (const w of (src.work_items ?? []) as DailyLogWorkItem[]) {
      const v: DailyLogWorkItem = {
        work_item_id: w.work_item_id,
        qty: w.qty,
        qty_mode: w.qty_mode ?? "absolute",
        note: w.note ?? "",
      };
      if (unsignedIds.has(w.work_item_id)) cloneUnsigned.push(v);
      else if (contractIds.has(w.work_item_id)) cloneContract.push(v);
      // 兩邊都查不到 → 多半是已歸到追加合約的 extra,複製時不帶過來
    }
    cloneInitial = {
      caseId: src.case_id,
      logDate: today,
      weather: parseWeather(src.weather),
      manpowerTodayTotal: 0,
      // 工別 / 機具:保留 trade / name,但「本日」清空(累計由 caseData 自動算)
      subcontractors: (src.manpower?.subcontractors ?? []).map((x) => ({
        trade: x.trade,
      })),
      machines: (src.manpower?.machines ?? []).map((x) => ({ name: x.name })),
      workItems: cloneContract,
      pickedExtra: [],
      pickedUnsigned: cloneUnsigned,
      extraItems: [],
      unsignedItems: [],
      photos: [],
      vendorNotices: "",
      notes: "",
    };
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
        currentUserName={actor.fullName ?? emailToUsername(actor.email ?? undefined) ?? "未命名使用者"}
        caseData={caseData}
        initial={cloneInitial}
        skipDraftRestore={!!prefilledFrom}
      />
    </div>
  );
}
