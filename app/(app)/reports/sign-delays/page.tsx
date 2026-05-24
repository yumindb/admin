import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { formatDateTW } from "@/lib/datetime";
import type { ApprovalStage } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 簽核延遲分析 — 老闆視角的 wishlist。
 *
 * 痛點(老闆視角測試):
 *   「本週簽核延遲統計 — 哪一關卡住了。」reports/page 寫「即將推出」,沒做。
 *
 * 設計:
 *   1. 目前各關 pending 摘要(數量 + 最久等了幾天 + 平均等候)
 *   2. 本週已完成日誌的平均處理時間 — 每關平均花多久
 *   3. 本週還在等簽的 logs Top 10(最久排在最上)
 */

const STAGE_LABEL: Record<ApprovalStage, string> = {
  fill: "填寫",
  review: "工地主任複核",
  audit: "辦公室助理審核",
  approve: "老闆核定",
};

const VISIBLE_STAGES: ApprovalStage[] = ["audit", "approve"]; // review 目前未啟用

function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms / (24 * 60 * 60 * 1000);
}

function fmtDays(d: number): string {
  if (d < 1) {
    const hours = Math.round(d * 24);
    return `${hours} 小時`;
  }
  return `${d.toFixed(1)} 天`;
}

export default async function SignDelaysPage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role === "field_assistant" || actor.role === "site_supervisor") {
    redirect("/");
  }

  const supabase = await createClient();
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  // 1. 目前 pending 各 stage 的 logs
  const { data: pendingLogs } = await supabase
    .from("daily_logs")
    .select(
      "id, current_stage, submitted_at, log_date, cases(name, code), profiles!daily_logs_supervisor_id_fkey(full_name)",
    )
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true });

  // 2. 本週已完成簽核的 approval events(approve decision)
  const { data: weekApprovals } = await supabase
    .from("log_approvals")
    .select("log_id, stage, decision, created_at")
    .gte("created_at", sevenDaysAgo.toISOString())
    .order("created_at", { ascending: true });

  // 算「日誌到了某 stage 等了多久才下決定」
  // 對每筆 approval event,前一個 event 的 created_at 即為「此 stage 開始時間」
  // 第一個 approval 的開始時間 = log.submitted_at(若有撈)
  const logsForApprovals = Array.from(
    new Set((weekApprovals ?? []).map((a) => a.log_id as string)),
  );
  const { data: relatedLogs } = logsForApprovals.length
    ? await supabase
        .from("daily_logs")
        .select("id, submitted_at")
        .in("id", logsForApprovals)
    : { data: [] };
  const submittedAtById = new Map<string, string>();
  for (const r of (relatedLogs ?? []) as Array<{ id: string; submitted_at: string | null }>) {
    if (r.submitted_at) submittedAtById.set(r.id, r.submitted_at);
  }

  // 把同一個 log 的 approvals 按 stage 串起來,算每段時長
  const approvalsByLog = new Map<
    string,
    Array<{ stage: ApprovalStage; created_at: string; decision: string }>
  >();
  for (const a of (weekApprovals ?? []) as Array<{
    log_id: string;
    stage: ApprovalStage;
    decision: string;
    created_at: string;
  }>) {
    const arr = approvalsByLog.get(a.log_id) ?? [];
    arr.push(a);
    approvalsByLog.set(a.log_id, arr);
  }

  // 每個 stage 累計時長 + 樣本數
  const stageStats = new Map<
    ApprovalStage,
    { totalDays: number; count: number; maxDays: number }
  >();
  for (const stage of VISIBLE_STAGES) {
    stageStats.set(stage, { totalDays: 0, count: 0, maxDays: 0 });
  }
  for (const [logId, events] of approvalsByLog) {
    // sort by created_at
    events.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let prevTime = submittedAtById.get(logId) ?? events[0].created_at;
    for (const e of events) {
      const d = daysBetween(prevTime, e.created_at);
      const bucket = stageStats.get(e.stage);
      if (bucket && d > 0) {
        bucket.totalDays += d;
        bucket.count += 1;
        if (d > bucket.maxDays) bucket.maxDays = d;
      }
      prevTime = e.created_at;
    }
  }

  // 3. 目前 pending 各 stage 的統計(數量 / 最久等了幾天 / 平均等候)
  type StageRow = {
    stage: ApprovalStage;
    pending: Array<{
      id: string;
      label: string;
      author: string;
      submittedAt: string;
      daysWaiting: number;
    }>;
    avgCompletedDays: number | null;
    maxCompletedDays: number;
    completedSampleSize: number;
  };
  const pendingList = (pendingLogs ?? []) as unknown as Array<{
    id: string;
    current_stage: ApprovalStage;
    submitted_at: string | null;
    log_date: string;
    cases: { name: string; code: string | null } | null;
    profiles: { full_name: string } | null;
  }>;

  const rows: StageRow[] = VISIBLE_STAGES.map((stage) => {
    const stageStat = stageStats.get(stage)!;
    const stagePending = pendingList
      .filter((l) => l.current_stage === stage && l.submitted_at)
      .map((l) => ({
        id: l.id,
        label: `${l.cases?.code ?? ""}${l.cases?.code ? "｜" : ""}${l.cases?.name ?? "（已刪除）"} · ${formatDateTW(l.log_date)}`,
        author: l.profiles?.full_name ?? "—",
        submittedAt: l.submitted_at!,
        daysWaiting: (now - new Date(l.submitted_at!).getTime()) / (24 * 60 * 60 * 1000),
      }))
      .sort((a, b) => b.daysWaiting - a.daysWaiting);
    return {
      stage,
      pending: stagePending,
      avgCompletedDays:
        stageStat.count > 0 ? stageStat.totalDays / stageStat.count : null,
      maxCompletedDays: stageStat.maxDays,
      completedSampleSize: stageStat.count,
    };
  });

  // 哪一關最卡 — 找平均等候最久的 stage
  const slowestStage = [...rows]
    .filter((r) => r.avgCompletedDays !== null)
    .sort(
      (a, b) => (b.avgCompletedDays ?? 0) - (a.avgCompletedDays ?? 0),
    )[0];

  // Top 10 最久還沒簽的 logs(跨 stage)
  const topPending = rows
    .flatMap((r) => r.pending.map((p) => ({ ...p, stage: r.stage })))
    .sort((a, b) => b.daysWaiting - a.daysWaiting)
    .slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/reports" className="hover:text-accent">
          報表
        </Link>
        <span className="mx-1.5">／</span>
        <span>簽核延遲分析</span>
      </nav>
      <h1 className="mb-1 text-2xl font-semibold text-primary md:text-3xl">
        簽核延遲分析
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        本週各關平均花多久簽完、目前最久還在等的日誌 — 協助辨識流程瓶頸。
      </p>

      {slowestStage && (
        <div className="mb-6 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]">
          <strong>本週瓶頸：</strong>「{STAGE_LABEL[slowestStage.stage]}」關平均花
          <span className="mx-1 font-semibold tabular-nums">
            {fmtDays(slowestStage.avgCompletedDays!)}
          </span>
          才完成（取樣 {slowestStage.completedSampleSize} 筆，最久{" "}
          {fmtDays(slowestStage.maxCompletedDays)}）
        </div>
      )}

      {/* 各關卡狀態卡 */}
      <div className="mb-7 grid grid-cols-1 gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <section
            key={r.stage}
            className="rounded-lg border border-[#E0DCD6] bg-card p-5"
          >
            <h2 className="text-base font-semibold text-primary">
              {STAGE_LABEL[r.stage]}
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">目前待簽</div>
                <div className="mt-0.5 text-2xl font-semibold tabular-nums text-primary">
                  {r.pending.length}
                </div>
                {r.pending[0] && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    最久等了 {fmtDays(r.pending[0].daysWaiting)}
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">本週平均處理</div>
                <div className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
                  {r.avgCompletedDays !== null
                    ? fmtDays(r.avgCompletedDays)
                    : "—"}
                </div>
                {r.completedSampleSize > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    取樣 {r.completedSampleSize} 筆
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Top 10 最久還沒簽 */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-primary md:text-lg">
          目前最久還在等的日誌
        </h2>
        {topPending.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-12 text-center text-sm text-muted-foreground">
            目前沒有待簽日誌
          </div>
        ) : (
          <ul className="divide-y divide-[#E0DCD6] rounded-lg border border-[#E0DCD6] bg-card">
            {topPending.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/approvals/${p.id}`}
                  className="block px-4 py-3 transition-colors hover:bg-[#FAF7F2]"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {p.label}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                        p.daysWaiting >= 2
                          ? "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]"
                          : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"
                      }`}
                    >
                      等 {fmtDays(p.daysWaiting)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                    <span>{p.author}</span>
                    <span>卡在「{STAGE_LABEL[p.stage]}」</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
