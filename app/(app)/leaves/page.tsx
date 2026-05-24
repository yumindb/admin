import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { formatTW } from "@/lib/datetime";
import { NextStepHint } from "@/components/next-step-hint";
import {
  LEAVE_STATUS_CLS,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  ROLE_LABEL,
  canApplyLeave,
} from "@/lib/leave";
import type { LeaveRequest, LeaveStatus, UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = LeaveRequest & {
  applicant: { full_name: string | null } | null;
};

export default async function LeavesPage() {
  const me = await tryGetActor();
  if (!me) redirect("/login");

  const supabase = await createClient();

  // 我送出的(任何角色都可看自己的;owner 通常沒有,空陣列就好)
  const { data: mineRaw } = await supabase
    .from("leave_requests")
    .select("*, applicant:profiles!applicant_id(full_name)")
    .eq("applicant_id", me.id)
    .order("submitted_at", { ascending: false })
    .limit(100);

  // 待我簽核 — 對應我的 role 在 current_step;排除自己送的
  const { data: pendingRaw } = await supabase
    .from("leave_requests")
    .select("*, applicant:profiles!applicant_id(full_name)")
    .eq("status", "pending")
    .eq("current_step", me.role)
    .neq("applicant_id", me.id)
    .order("submitted_at", { ascending: true })
    .limit(100);

  const mine = (mineRaw ?? []) as Row[];
  const pending = (pendingRaw ?? []) as Row[];

  const canCreate = canApplyLeave(me.role);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-7 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">
            請假
          </h1>
          <p className="mt-1.5 text-base text-muted-foreground">
            {canCreate
              ? "送出後會自動依層級往上送簽。可隨時取消尚未完成的申請。"
              : "下面是等您簽核的請假申請。"}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/leaves/new"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-[#8B6845] bg-[#A07850] px-5 text-base font-medium tracking-wider text-white shadow-sm transition-all duration-150 hover:bg-[#8B6845] active:scale-[0.97]"
          >
            <Plus className="size-5" strokeWidth={2.25} aria-hidden />
            <span>新請假</span>
          </Link>
        )}
      </div>

      {/* 待我簽核 — 永遠擺在最上面，有就最優先處理 */}
      <section className="mb-9">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-primary">待我簽核</h2>
          {pending.length > 0 && (
            <span
              aria-label={`待簽 ${pending.length} 筆`}
              className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-[#B91C1C] px-2 py-0.5 text-sm font-semibold tabular-nums text-white"
            >
              {pending.length}
            </span>
          )}
        </div>
        {!pending.length ? (
          <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            目前沒有等你簽的請假
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <li key={r.id}>
                <RequestCard row={r} highlight />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 我的請假 */}
      {canCreate && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-primary">我的請假</h2>
          {!mine.length ? (
            <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-5 py-12 text-center">
              <p className="text-base text-foreground">尚無請假紀錄</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                按右上「新請假」開始填單
              </p>
              <NextStepHint tone="muted" className="mt-4 text-left">
                送出後會自動依層級往上簽，你會在這裡看到每一關進度。
              </NextStepHint>
            </div>
          ) : (
            <ul className="space-y-3">
              {mine.map((r) => (
                <li key={r.id}>
                  <RequestCard row={r} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function RequestCard({ row: r, highlight }: { row: Row; highlight?: boolean }) {
  const status = r.status as LeaveStatus;
  const cls = LEAVE_STATUS_CLS[status];
  const dateRange = `${formatTW(r.start_at, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })} — ${formatTW(r.end_at, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  const stepLabel = r.current_step
    ? `等 ${ROLE_LABEL[r.current_step]} 簽核`
    : null;
  return (
    <Link
      href={`/leaves/${r.id}`}
      className={`block rounded-lg border bg-card p-4 transition-colors hover:border-accent active:bg-[#FAF7F2] ${
        highlight ? "border-[#A07850]/60" : "border-[#E0DCD6]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-semibold text-primary">
              {LEAVE_TYPE_LABEL[r.leave_type]}
            </span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {r.total_hours} 小時
            </span>
            <span className="text-sm text-muted-foreground">
              · {r.applicant?.full_name ?? "—"}
              {" · "}
              {ROLE_LABEL[r.applicant_role as UserRole]}
            </span>
          </div>
          <div className="mt-1 text-sm tabular-nums text-foreground">
            {dateRange}
          </div>
          {r.reason && (
            <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
              {r.reason}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${cls}`}
        >
          {LEAVE_STATUS_LABEL[status]}
        </span>
      </div>
      {stepLabel && (
        <div className="mt-2 text-xs text-muted-foreground">{stepLabel}</div>
      )}
    </Link>
  );
}
