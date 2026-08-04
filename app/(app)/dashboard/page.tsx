import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/db/fetch-all";
import { tryGetActor } from "@/lib/auth/require-role";
import { formatDateTW } from "@/lib/datetime";
import {
  BEHIND_GAP_PP,
  computeCaseProgress,
  daysSince,
  isCaseBehind,
  plannedDaysBetween,
  primaryProgressPct,
  type CaseStats,
} from "@/lib/case-progress";
import { normalizeLogPhotos } from "@/lib/daily-log";
import { AlertsSection, type AlertItem } from "./alerts-section";
import type {
  Case,
  CaseWorkItem,
  DailyLog,
  DailyLogUnsignedItem,
  DailyLogWorkItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 老闆 Dashboard — 老闆視角測試的 P0 改動。
 *
 * Phil 早上車上滑手機要看「全公司紅綠燈」,不是又一份待辦清單。
 * 四張卡:
 *   1. 待核定:數量 + 等最久 N 天 + CTA
 *   2. 進度落後:N 個案場 (< 30% 且開工 > 60 天) + 列名
 *   3. 今日未打卡:有 active 案件的主任今天沒打卡 (anti-join attendance)
 *   4. 合約外 + 未簽約金額:全公司累計
 */
export default async function DashboardPage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "owner" && actor.role !== "office_staff") {
    redirect("/");
  }

  const supabase = await createClient();
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 4 個獨立 query 並行
  const [
    pendingApprovals,
    activeCases,
    todaysAttendance,
    activeSupervisors,
  ] = await Promise.all([
    // 1) 待核定 (owner 才有意義;office_staff 看自己的待審 audit stage)
    supabase
      .from("daily_logs")
      .select("id, submitted_at, case_id, cases(code, name)")
      .eq("status", "submitted")
      .eq("current_stage", actor.role === "owner" ? "approve" : "audit")
      .order("submitted_at", { ascending: true }),
    // 2) 進度落後 + 到期提醒計算需要 cases + 工項 + 日誌
    supabase
      .from("cases")
      .select("id, code, name, started_at, expected_end, status")
      .in("status", ["active", "paused"])
      .order("created_at", { ascending: false })
      .limit(200),
    // 3) 今日所有打卡事件(只看 site_supervisor 跟 field_assistant 的)
    supabase
      .from("attendance_events")
      .select("user_id, created_at")
      .gte("created_at", todayStart.toISOString()),
    // 4) 所有 active site_supervisor 給 anti-join 用
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("is_active", true)
      .in("role", ["site_supervisor"]),
  ]);

  // 1. 待核定統計
  const pendingList = (pendingApprovals.data ?? []) as unknown as Array<{
    id: string;
    submitted_at: string | null;
    case_id: string | null;
    cases: { code: string | null; name: string } | null;
  }>;
  const pendingCount = pendingList.length;
  const oldestPendingDays = (() => {
    const oldest = pendingList[0];
    if (!oldest?.submitted_at) return null;
    const ms = now - new Date(oldest.submitted_at).getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  })();

  // 2. 進度落後 — 需要算每個 case 的 progressPct + startedDaysAgo
  // 為了不撈 200 個案件的所有日誌(會慢),只撈 active 案件 + 已過 60 天的
  const cases = (activeCases.data ?? []) as Pick<
    Case,
    "id" | "code" | "name" | "started_at" | "expected_end" | "status"
  >[];

  // 到期提醒:預計完工日(expected_end)已過 = 逾期;7 天內到 = 即將到期。
  // 用台北時區的日期字串比對(expected_end 是 date 欄位,避免 UTC 差 8 小時的邊界)
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  const in7Key = new Date(now + 7 * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Taipei",
  });
  const overdueCases = cases.filter((c) => c.expected_end && c.expected_end < todayKey);
  const dueSoonCases = cases.filter(
    (c) => c.expected_end && c.expected_end >= todayKey && c.expected_end <= in7Key,
  );
  // 落後判斷要比對「照工期該有的進度」,所以開工日 + 預定完工日都要有。
  // 工期還沒走過 BEHIND_GAP_PP% 的案件不可能落後那麼多,先用日期篩掉,
  // 免得為了算進度去撈一堆案件的工項與日誌。
  const candidateCases = cases.filter((c) => {
    const planned = plannedDaysBetween(c.started_at, c.expected_end);
    const elapsed = daysSince(c.started_at);
    if (planned === null || elapsed === null) return false;
    return elapsed / planned > BEHIND_GAP_PP / 100;
  });

  const behindCases: { id: string; code: string | null; name: string; pct: number }[] = [];
  if (candidateCases.length > 0) {
    const oldCaseIds = candidateCases.map((c) => c.id);
    // fetchAllRows:真實標單案 1200+ 工項會超 PostgREST 1000 筆上限
    const [{ data: workItems }, { data: logs }] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("case_work_items")
          .select("id, case_id, item_type, quantity, total_price, skipped")
          .in("case_id", oldCaseIds)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("daily_logs")
          .select("id, case_id, status, work_items, log_date")
          .in("case_id", oldCaseIds)
          .in("status", ["submitted", "approved", "rejected"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    const items = (workItems ?? []) as Pick<
      CaseWorkItem,
      "id" | "case_id" | "item_type" | "quantity" | "total_price" | "skipped"
    >[];
    const allLogs = (logs ?? []) as Pick<
      DailyLog,
      "case_id" | "status" | "work_items" | "log_date"
    >[];
    const progressByCase = computeCaseProgress(items, allLogs);

    for (const c of candidateCases) {
      const p = progressByCase.get(c.id);
      const progressPct = primaryProgressPct(p);
      const stats: CaseStats = {
        itemCount: 0,
        logCount: 0,
        progressPct,
        itemProgressPct: p?.itemPct ?? null,
        extraCount: 0,
        unsignedCount: 0,
        photos: [],
        photoTotal: 0,
        startedDaysAgo: daysSince(c.started_at),
        plannedDays: plannedDaysBetween(c.started_at, c.expected_end),
      };
      if (isCaseBehind(stats) && progressPct !== null) {
        behindCases.push({
          id: c.id,
          code: c.code,
          name: c.name,
          pct: progressPct,
        });
      }
    }
  }
  behindCases.sort((a, b) => a.pct - b.pct);

  // 3. 今日未打卡主任 = active supervisors − today 打卡過的
  const supervisors = (activeSupervisors.data ?? []) as Array<{
    id: string;
    full_name: string;
    role: string;
  }>;
  const clockedInToday = new Set(
    (todaysAttendance.data ?? []).map((e) => e.user_id as string),
  );
  const missingClockIn = supervisors.filter((s) => !clockedInToday.has(s.id));

  // 4. 本月新增合約外 + 未簽約金額(更 actionable — 累計沒辦法看出趨勢)
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();

  const [{ data: contracts }, { data: unsignedItems }] = await Promise.all([
    supabase
      .from("extra_contracts")
      .select("bundle_price, id, case_id, created_at")
      .gte("created_at", monthStartIso),
    supabase
      .from("case_work_items")
      .select("id, case_id, item_type, quantity, unit_price, created_at")
      .eq("item_type", "unsigned")
      .gte("created_at", monthStartIso),
  ]);

  let contractSum = 0;
  for (const c of contracts ?? []) {
    if (c.bundle_price !== null && c.bundle_price !== undefined) {
      contractSum += Number(c.bundle_price);
    }
  }
  let unsignedSum = 0;
  for (const u of unsignedItems ?? []) {
    const qty = (u.quantity as number | null) ?? 0;
    const price = (u.unit_price as number | null) ?? 0;
    unsignedSum += qty * price;
  }
  const monthExtraSum = contractSum + unsignedSum;

  // 5.「需要您出手」異常偵測 — Phil 視角:不是每件都要簽,是要看「卡住的」
  //   - 退回後超過 2 天還沒重送的日誌(supervisor 卡住沒處理)
  //   - active 案件超過 5 天沒新日誌(可能停工 / 沒人管)
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  const [{ data: stuckRejected }, { data: recentLogsByCase }] = await Promise.all([
    supabase
      .from("daily_logs")
      .select(
        "id, case_id, log_date, updated_at, cases(name, code), profiles!daily_logs_supervisor_id_fkey(full_name)",
      )
      .eq("status", "rejected")
      .lte("updated_at", twoDaysAgo.toISOString())
      .order("updated_at", { ascending: true })
      .limit(20),
    // 抓所有 active 案件最近的日誌 — 之後用 client-side 算「最後一筆距今幾天」
    cases.length > 0
      ? fetchAllRows((from, to) =>
          supabase
            .from("daily_logs")
            .select("id, case_id, log_date")
            .in(
              "case_id",
              cases.filter((c) => c.status === "active").map((c) => c.id),
            )
            .order("log_date", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve({ data: [] }),
  ]);

  const lastLogDateByCase = new Map<string, string>();
  for (const r of (recentLogsByCase ?? []) as Array<{
    case_id: string;
    log_date: string;
  }>) {
    if (!lastLogDateByCase.has(r.case_id)) {
      lastLogDateByCase.set(r.case_id, r.log_date);
    }
  }
  const staleCases: Array<{
    id: string;
    code: string | null;
    name: string;
    daysSinceLog: number;
  }> = [];
  for (const c of cases) {
    if (c.status !== "active") continue;
    const last = lastLogDateByCase.get(c.id);
    let daysSinceLog: number;
    if (!last) {
      // 從未填過日誌:若 started_at > 5 天前才算 stale
      if (!c.started_at) continue;
      daysSinceLog = Math.floor(
        (now - new Date(c.started_at).getTime()) / (24 * 60 * 60 * 1000),
      );
    } else {
      daysSinceLog = Math.floor(
        (now - new Date(last).getTime()) / (24 * 60 * 60 * 1000),
      );
    }
    if (daysSinceLog >= 5) {
      staleCases.push({
        id: c.id,
        code: c.code,
        name: c.name,
        daysSinceLog,
      });
    }
  }
  staleCases.sort((a, b) => b.daysSinceLog - a.daysSinceLog);

  const alerts: AlertItem[] = [];
  for (const r of (stuckRejected ?? []) as unknown as Array<{
    id: string;
    log_date: string;
    updated_at: string;
    cases: { name: string; code: string | null } | null;
    profiles: { full_name: string } | null;
  }>) {
    const days = Math.floor(
      (now - new Date(r.updated_at).getTime()) / (24 * 60 * 60 * 1000),
    );
    alerts.push({
      kind: "rejected",
      targetId: r.id,
      title: `${r.cases?.code ?? ""}${r.cases?.code ? "｜" : ""}${r.cases?.name ?? "（已刪除）"}`,
      detail: `${r.profiles?.full_name ?? "主任"} 的 ${r.log_date} 日誌已退回 ${days} 天，尚未重送`,
      href: `/logs/${r.id}`,
    });
  }
  for (const c of staleCases.slice(0, 10)) {
    alerts.push({
      kind: "stale",
      targetId: c.id,
      title: `${c.code ?? ""}${c.code ? "｜" : ""}${c.name}`,
      detail: `已 ${c.daysSinceLog} 天沒有新日誌`,
      href: `/cases/${c.id}`,
    });
  }

  // 「先不理」中的警示(migration-2.30)。migration 未跑 → 查詢出錯就當作沒有,
  // 儀表板照常顯示全部,不因此壞掉。
  const { data: dismissRows } = await supabase
    .from("dashboard_dismissals")
    .select("alert_kind, target_id, dismissed_until")
    .eq("profile_id", actor.id)
    .gt("dismissed_until", new Date().toISOString());
  const dismissedKeys = new Set(
    ((dismissRows ?? []) as Array<{ alert_kind: string; target_id: string }>).map(
      (d) => `${d.alert_kind}:${d.target_id}`,
    ),
  );
  const visibleAlerts = alerts.filter(
    (a) => !dismissedKeys.has(`${a.kind}:${a.targetId}`),
  );
  // 只算「還在清單裡但被收起來」的,避免顯示早已解決的殘留筆數
  const dismissedCount = alerts.length - visibleAlerts.length;

  const isOwner = actor.role === "owner";
  const pendingPath = isOwner ? "/approvals" : "/approvals";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary md:text-3xl">
          {isOwner ? "老闆儀表板" : "辦公室儀表板"}
        </h1>
        <p className="mt-1.5 text-base text-muted-foreground">
          全公司今天的紅綠燈，有紅燈再點進去處理
        </p>
      </div>

      {/* 「需要您出手」異常 banner — Phil 視角:不是每件都要簽,而是要看
          「真正卡住的」。退回後 ≥ 2 天 + 案件 ≥ 5 天沒日誌 兩種訊號合併。
          每項可「先不理」(per-user、7 天後自動再提醒,見 alerts-section.tsx)。 */}
      <AlertsSection alerts={visibleAlerts} dismissedCount={dismissedCount} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 卡 1：待核定 / 待審 */}
        <DashCard
          tone={pendingCount > 0 ? (oldestPendingDays !== null && oldestPendingDays >= 2 ? "red" : "amber") : "green"}
          title={isOwner ? "待核定" : "待審核"}
          value={pendingCount.toString()}
          unit="份"
          hint={
            pendingCount === 0
              ? "全部簽完，辛苦了"
              : oldestPendingDays !== null && oldestPendingDays >= 2
                ? `最久等了 ${oldestPendingDays} 天，該處理了`
                : oldestPendingDays !== null && oldestPendingDays >= 1
                  ? `最久等了 ${oldestPendingDays} 天`
                  : "今天剛送出的"
          }
          cta={pendingCount > 0 ? { href: pendingPath, label: "跳去簽" } : undefined}
        />

        {/* 卡 2：進度落後 */}
        <DashCard
          tone={behindCases.length > 0 ? "red" : "green"}
          title="進度落後案場"
          value={behindCases.length.toString()}
          unit="個"
          hint={
            behindCases.length === 0
              ? "沒有進度落後的案場"
              : `比工期該有的進度落後 ${BEHIND_GAP_PP} 個百分點以上：${behindCases
                  .slice(0, 3)
                  .map((c) => `${c.code ?? ""}${c.code ? "｜" : ""}${c.name} (${c.pct}%)`)
                  .join("、")}${behindCases.length > 3 ? "…" : ""}`
          }
          cta={
            behindCases.length > 0
              ? { href: "/cases?filter=behind", label: "查看案件" }
              : undefined
          }
        />

        {/* 卡 2.5：到期提醒 — expected_end 已過或 7 天內到 */}
        <DashCard
          tone={overdueCases.length > 0 ? "red" : dueSoonCases.length > 0 ? "amber" : "green"}
          title="到期案件"
          value={String(overdueCases.length + dueSoonCases.length)}
          unit="個"
          hint={
            overdueCases.length === 0 && dueSoonCases.length === 0
              ? "沒有逾期或 7 天內到期的案件"
              : [
                  ...overdueCases
                    .slice(0, 3)
                    .map(
                      (c) =>
                        `${c.code ?? ""}${c.code ? "｜" : ""}${c.name}（逾期，原定 ${formatDateTW(c.expected_end)}）`,
                    ),
                  ...dueSoonCases
                    .slice(0, Math.max(0, 3 - overdueCases.length))
                    .map(
                      (c) =>
                        `${c.code ?? ""}${c.code ? "｜" : ""}${c.name}（${formatDateTW(c.expected_end)} 到期）`,
                    ),
                ].join("、") +
                (overdueCases.length + dueSoonCases.length > 3 ? "…" : "")
          }
          cta={
            overdueCases.length + dueSoonCases.length > 0
              ? { href: "/reports/cases-overview", label: "看案件總覽" }
              : undefined
          }
        />

        {/* 卡 3：今日未打卡主任 */}
        <DashCard
          tone={missingClockIn.length > 0 ? "amber" : "green"}
          title="今日未打卡主任"
          value={missingClockIn.length.toString()}
          unit={`/ ${supervisors.length}`}
          hint={
            missingClockIn.length === 0
              ? "所有主任都打卡了"
              : missingClockIn
                  .slice(0, 5)
                  .map((s) => s.full_name)
                  .join("、") + (missingClockIn.length > 5 ? "…" : "")
          }
          cta={
            supervisors.length > 0
              ? { href: "/reports/today-attendance", label: "看紅綠燈" }
              : undefined
          }
        />

        {/* 卡 4：本月新增合約外 + 未簽約金額（actionable signal — 累計沒意義） */}
        <DashCard
          tone={monthExtraSum > 0 ? "amber" : "green"}
          title="本月新增合約外金額"
          value={monthExtraSum > 0 ? monthExtraSum.toLocaleString("zh-TW") : "0"}
          unit="元"
          hint={
            monthExtraSum === 0
              ? "本月還沒有新增的合約外項目"
              : `追加合約 ${contractSum.toLocaleString("zh-TW")} + 未簽約 ${unsignedSum.toLocaleString("zh-TW")}`
          }
          cta={
            monthExtraSum > 0
              ? { href: "/reports/unsigned", label: "看明細" }
              : undefined
          }
        />
      </div>

      <div className="mt-6 rounded-md border border-[#E0DCD6] bg-card px-4 py-3 text-sm text-muted-foreground">
        💡 提示：資料每次打開都重撈，不需要刷新。LINE 通知串接後，有事直接彈訊息給你。
      </div>
    </div>
  );
}

function DashCard({
  tone,
  title,
  value,
  unit,
  hint,
  cta,
}: {
  tone: "green" | "amber" | "red";
  title: string;
  value: string;
  unit: string;
  hint: string;
  cta?: { href: string; label: string };
}) {
  const toneClasses = {
    green: {
      border: "border-[#A7F3D0]",
      bg: "bg-[#ECFDF5]",
      text: "text-[#15803D]",
      dotBg: "bg-[#4A7C59]",
    },
    amber: {
      border: "border-[#FDE68A]",
      bg: "bg-[#FFFBEB]",
      text: "text-[#92400E]",
      dotBg: "bg-[#D97706]",
    },
    red: {
      border: "border-[#FCA5A5]",
      bg: "bg-[#FEF2F2]",
      text: "text-[#B91C1C]",
      dotBg: "bg-[#B91C1C]",
    },
  }[tone];

  return (
    <section
      className={`rounded-lg border ${toneClasses.border} ${toneClasses.bg} p-4`}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-block size-2.5 rounded-full ${toneClasses.dotBg}`}
        />
        <h2 className="text-base font-semibold text-primary">{title}</h2>
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className={`text-4xl font-bold tabular-nums ${toneClasses.text}`}
        >
          {value}
        </span>
        <span className={`text-sm ${toneClasses.text}`}>{unit}</span>
      </div>
      <p className={`mt-2 text-sm ${toneClasses.text} opacity-90`}>{hint}</p>
      {cta && (
        <div className="mt-3">
          <Link
            href={cta.href}
            className={`inline-flex h-11 items-center rounded-md border ${toneClasses.border} bg-white px-4 text-sm font-medium ${toneClasses.text} hover:bg-white/70`}
          >
            {cta.label} →
          </Link>
        </div>
      )}
    </section>
  );
}
