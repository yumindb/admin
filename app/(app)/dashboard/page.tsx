import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/db/fetch-all";
import { tryGetActor } from "@/lib/auth/require-role";
import { formatDateTW } from "@/lib/datetime";
import { isCaseBehind, type CaseStats } from "@/lib/case-progress";
import { normalizeLogPhotos } from "@/lib/daily-log";
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
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const oldCases = cases.filter((c) => {
    if (!c.started_at) return false;
    return new Date(c.started_at) < sixtyDaysAgo;
  });

  const behindCases: { id: string; code: string | null; name: string; pct: number }[] = [];
  if (oldCases.length > 0) {
    const oldCaseIds = oldCases.map((c) => c.id);
    // fetchAllRows:真實標單案 1200+ 工項會超 PostgREST 1000 筆上限
    const [{ data: workItems }, { data: logs }] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("case_work_items")
          .select("id, case_id, item_type, quantity")
          .in("case_id", oldCaseIds)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("daily_logs")
          .select("id, case_id, status, work_items, log_date")
          .in("case_id", oldCaseIds)
          .in("status", ["submitted", "approved"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    const items = (workItems ?? []) as Pick<
      CaseWorkItem,
      "id" | "case_id" | "item_type" | "quantity"
    >[];
    const itemMeta = new Map<string, (typeof items)[number]>();
    for (const it of items) itemMeta.set(it.id, it);

    const doneByItem = new Map<string, number>();
    for (const log of (logs ?? []) as Pick<DailyLog, "case_id" | "status" | "work_items" | "log_date">[]) {
      for (const w of (log.work_items ?? []) as DailyLogWorkItem[]) {
        const meta = itemMeta.get(w.work_item_id);
        if (!meta) continue;
        const total = meta.quantity ?? 0;
        const inc = w.qty_mode === "percent" ? total * w.qty : w.qty;
        doneByItem.set(w.work_item_id, (doneByItem.get(w.work_item_id) ?? 0) + inc);
      }
    }

    const pctSumByCase = new Map<string, number>();
    const pctCountByCase = new Map<string, number>();
    for (const it of items) {
      // manual 也算進度(與案件列表一致;無標單小案只有 manual 工項)
      if (it.item_type !== "item" && it.item_type !== "spec" && it.item_type !== "manual") continue;
      const total = it.quantity ?? 0;
      const done = doneByItem.get(it.id) ?? 0;
      const pct = total > 0 ? Math.min(1, done / total) : done > 0 ? 1 : 0;
      pctSumByCase.set(it.case_id, (pctSumByCase.get(it.case_id) ?? 0) + pct);
      pctCountByCase.set(it.case_id, (pctCountByCase.get(it.case_id) ?? 0) + 1);
    }

    for (const c of oldCases) {
      const startedDaysAgo = c.started_at
        ? Math.floor((now - new Date(c.started_at).getTime()) / (24 * 60 * 60 * 1000))
        : null;
      const sum = pctSumByCase.get(c.id) ?? 0;
      const count = pctCountByCase.get(c.id) ?? 0;
      const progressPct = count > 0 ? Math.round((sum / count) * 1000) / 10 : null;
      const stats: CaseStats = {
        itemCount: count,
        logCount: 0,
        progressPct,
        extraCount: 0,
        unsignedCount: 0,
        photos: [],
        photoTotal: 0,
        startedDaysAgo,
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

  type AlertItem = {
    kind: "rejected" | "stale";
    title: string;
    detail: string;
    href: string;
  };
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
      title: `${r.cases?.code ?? ""}${r.cases?.code ? "｜" : ""}${r.cases?.name ?? "（已刪除）"}`,
      detail: `${r.profiles?.full_name ?? "主任"} 的 ${r.log_date} 日誌已退回 ${days} 天，尚未重送`,
      href: `/logs/${r.id}`,
    });
  }
  for (const c of staleCases.slice(0, 10)) {
    alerts.push({
      kind: "stale",
      title: `${c.code ?? ""}${c.code ? "｜" : ""}${c.name}`,
      detail: `已 ${c.daysSinceLog} 天沒有新日誌`,
      href: `/cases/${c.id}`,
    });
  }

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
          「真正卡住的」。退回後 ≥ 2 天 + 案件 ≥ 5 天沒日誌 兩種訊號合併。 */}
      {alerts.length > 0 && (
        <section className="mb-5 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] p-4">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className="inline-block size-2.5 rounded-full bg-[#B91C1C]" />
            <h2 className="text-base font-semibold text-[#B91C1C]">
              需要您出手（{alerts.length}）
            </h2>
          </div>
          <ul className="divide-y divide-[#FCA5A5]/40">
            {alerts.slice(0, 10).map((a, i) => (
              <li key={i}>
                <Link
                  href={a.href}
                  className="block py-2 transition-colors hover:bg-[#FEE2E2] -mx-2 px-2 rounded"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">
                      {a.title}
                    </span>
                    <span className="shrink-0 text-xs text-[#B91C1C]">
                      {a.kind === "rejected" ? "退回未重送" : "案件停滯"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {a.detail}
                  </div>
                </Link>
              </li>
            ))}
            {alerts.length > 10 && (
              <li className="pt-2 text-xs text-muted-foreground">
                …共 {alerts.length} 件，僅顯示前 10
              </li>
            )}
          </ul>
        </section>
      )}

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
              : `< 30% 且開工 > 60 天：${behindCases
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
