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
import { NextStepHint } from "@/components/next-step-hint";
import {
  addDaysToDate,
  formatDateWindow,
  formatProxyFiller,
  splitDelegations,
  type ProxyDelegation,
} from "@/lib/leave-proxy";
import { loadMyDelegations } from "@/lib/logs/proxy";

export default async function NewLogPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string; from?: string; leave?: string }>;
}) {
  const sp = await searchParams;
  const presetCaseId = sp.case;
  const supabase = await createClient();
  // layout 已載過(cache 命中)
  const actor = await tryGetActor();
  if (!actor) redirect("/login");

  // 請假代理人(migration-2.43):現場人員只有在代理期間能進來,替請假的主任填。
  // 同時有好幾段代理(兩位主任、或同一位主任請了兩次假)時用 ?leave=<假單 id> 切換,
  // 預設最早開始的那段 — 不能用主任 id 選,同一位主任的第二張假單會被第一張蓋掉
  let proxy: ProxyDelegation | null = null;
  let otherProxies: ProxyDelegation[] = [];
  if (actor.role === "field_assistant") {
    const { active } = splitDelegations(
      await loadMyDelegations(actor.id),
      todayLocalDate(),
    );
    if (active.length === 0) redirect("/logs");
    proxy = active.find((d) => d.leaveId === sp.leave) ?? active[0];
    otherProxies = active.filter((d) => d !== proxy);
  } else if (actor.role !== "site_supervisor" && actor.role !== "owner") {
    redirect("/logs");
  }
  // 「複製日誌」只給主任 / 老闆 — 代理人一律從空白開始
  const fromLogId = proxy ? undefined : sp.from;

  // 案件清單只帶選單需要的欄位 — 工項與累計等選定案件後才撈(見 lib/logs/case-form-data.ts)
  const [casesRes, srcRes, proxyRecentRes] = await Promise.all([
    supabase
      .from("cases")
      .select("id, name, code, company, location, expected_end")
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    // 「複製日誌」:?from=<id> 時撈來源 log 預填。RLS 自動擋越權讀取。
    fromLogId
      ? supabase.from("daily_logs").select("*").eq("id", fromLogId).maybeSingle()
      : Promise.resolve({ data: null }),
    // 代理人:請假主任最近 60 天寫過的案場排前面(多半就是這幾天要代寫的工地)
    proxy
      ? supabase
          .from("daily_logs")
          .select("case_id")
          .eq("supervisor_id", proxy.supervisorId)
          .gte("log_date", addDaysToDate(todayLocalDate(), -60))
          .order("log_date", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: null }),
  ]);

  let cases = casesRes.data ?? [];
  const src = srcRes.data as DailyLog | null;
  if (proxy && proxyRecentRes.data) {
    const rank = new Map<string, number>();
    for (const r of proxyRecentRes.data as { case_id: string }[]) {
      if (!rank.has(r.case_id)) rank.set(r.case_id, rank.size);
    }
    // 穩定排序:主任最近的案場依「最近寫過」在前,其他維持原本順序
    cases = [...cases].sort(
      (a, b) =>
        (rank.get(a.id as string) ?? Infinity) - (rank.get(b.id as string) ?? Infinity),
    );
  }

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

  const myName =
    actor.fullName ?? emailToUsername(actor.email ?? undefined) ?? "未命名使用者";

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

      {proxy && (
        <div className="mb-7">
          <NextStepHint tone="info" title={`代理 ${proxy.supervisorName} 填寫`}>
            {proxy.supervisorName} 請假（{formatDateWindow(proxy)}），指定你當代理人。
            這份日誌會以「{formatProxyFiller(myName, proxy.supervisorName)}」簽名送出，
            一樣送辦公室審核、核定人核定。日期只能選請假那幾天。
            {otherProxies.length > 0 && (
              <span className="mt-2 block">
                你也在代理：
                {otherProxies.map((d, i) => (
                  <span key={d.leaveId}>
                    {i > 0 && "、"}
                    <Link
                      href={`/logs/new?leave=${d.leaveId}`}
                      className="font-medium underline underline-offset-2"
                    >
                      {d.supervisorName}（{formatDateWindow(d)}）
                    </Link>
                  </span>
                ))}
                ，點名字切換。
              </span>
            )}
          </NextStepHint>
        </div>
      )}

      {prefilledFrom && (
        <div className="mb-7 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5 text-sm text-[#92400E] md:px-4 md:py-3">
          從 {formatDateTW(prefilledFrom.sourceLogDate)} 的日誌複製。
          請檢查工項數量與外包人員後再送出。
          照片、備註、簽名不會帶過來，日期已帶今天。
        </div>
      )}
      {!prefilledFrom && !proxy && <div className="mb-7" />}

      <NewLogForm
        // 切換代理的假單時整個表單重來(草稿依假單分開存)
        key={proxy?.leaveId ?? "self"}
        cases={caseOptions}
        presetCaseId={presetCaseId}
        currentUserName={
          proxy ? formatProxyFiller(myName, proxy.supervisorName) : myName
        }
        caseData={caseData}
        initial={cloneInitial}
        skipDraftRestore={!!prefilledFrom}
        proxy={
          proxy
            ? {
                leaveId: proxy.leaveId,
                supervisorId: proxy.supervisorId,
                startDate: proxy.startDate,
                endDate: proxy.endDate,
              }
            : undefined
        }
      />
    </div>
  );
}
