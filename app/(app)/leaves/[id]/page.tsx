import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { formatTW } from "@/lib/datetime";
import { NextStepHint } from "@/components/next-step-hint";
import {
  LEAVE_STATUS_CLS,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  ROLE_LABEL,
  canActOnLeave,
} from "@/lib/leave";
import type {
  LeaveApproval,
  LeaveRequest,
  LeaveStatus,
  UserRole,
} from "@/lib/types";
import { ApprovalButtons } from "./approval-buttons";
import { CancelButton } from "./cancel-button";

export const dynamic = "force-dynamic";

type RequestRow = LeaveRequest & {
  applicant: { full_name: string | null } | null;
};

type ApprovalRow = LeaveApproval & {
  approver: { full_name: string | null } | null;
};

export default async function LeaveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await tryGetActor();
  if (!me) redirect("/login");

  const supabase = await createClient();
  const { data: reqRow } = await supabase
    .from("leave_requests")
    .select("*, applicant:profiles!applicant_id(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!reqRow) notFound();
  const r = reqRow as RequestRow;

  const { data: approvalsRaw } = await supabase
    .from("leave_approvals")
    .select("*, approver:profiles!approver_id(full_name)")
    .eq("request_id", id)
    .order("created_at", { ascending: true });
  const approvals = (approvalsRaw ?? []) as ApprovalRow[];

  const isApplicant = r.applicant_id === me.id;
  const canAct = canActOnLeave(r, me.role, me.id);
  const status = r.status as LeaveStatus;

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/leaves" className="hover:text-accent">
          請假
        </Link>
        <span className="mx-1.5">／</span>
        <span>申請詳情</span>
      </nav>

      {/* 標題列 */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">
            {r.applicant?.full_name ?? "—"} ·{" "}
            {ROLE_LABEL[r.applicant_role as UserRole]}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-primary md:text-3xl">
            {LEAVE_TYPE_LABEL[r.leave_type]}
            <span className="ml-2 text-base font-normal tabular-nums text-muted-foreground">
              {r.total_hours} 小時
            </span>
          </h1>
        </div>
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-sm ${LEAVE_STATUS_CLS[status]}`}
        >
          {LEAVE_STATUS_LABEL[status]}
        </span>
      </div>

      {/* 基本資料 */}
      <section className="mb-7 grid grid-cols-1 gap-3 md:grid-cols-2">
        <InfoCard label="起始" value={formatTW(r.start_at)} />
        <InfoCard label="結束" value={formatTW(r.end_at)} />
        <InfoCard label="送出時間" value={formatTW(r.submitted_at)} />
        {r.resolved_at && (
          <InfoCard
            label={status === "approved" ? "核准時間" : "退回時間"}
            value={formatTW(r.resolved_at)}
          />
        )}
        {r.cancelled_at && (
          <InfoCard label="取消時間" value={formatTW(r.cancelled_at)} />
        )}
      </section>

      <section className="mb-7">
        <h2 className="mb-2 text-base font-semibold text-primary">事由</h2>
        <div className="whitespace-pre-line rounded-md border border-[#E0DCD6] bg-card p-4 text-base text-foreground">
          {r.reason}
        </div>
      </section>

      {/* 簽核流程 */}
      <section className="mb-7">
        <h2 className="mb-3 text-base font-semibold text-primary">簽核進度</h2>
        <ApprovalTimeline
          chain={r.approval_chain as UserRole[]}
          currentStep={r.current_step as UserRole | null}
          status={status}
          approvals={approvals}
        />
      </section>

      {/* 動作區 */}
      {canAct && (
        <section className="mb-6">
          <NextStepHint tone="info">
            這份輪到你簽核（身分：{ROLE_LABEL[me.role]}）。
            通過後會自動往上送下一關；退回則整份結束。
          </NextStepHint>
          <div className="mt-4">
            <ApprovalButtons requestId={r.id} />
          </div>
        </section>
      )}

      {isApplicant && status === "pending" && (
        <section className="mb-6">
          <NextStepHint tone="muted">
            尚在簽核中，你可以取消這份申請（取消後不可復原，若要請假請重送）。
          </NextStepHint>
          <div className="mt-4">
            <CancelButton requestId={r.id} />
          </div>
        </section>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#E0DCD6] bg-white px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-primary tabular-nums">
        {value}
      </div>
    </div>
  );
}

/**
 * 簽核進度時間軸 — 每個關卡一格,依 chain 順序顯示。
 * 對應到的 approval 紀錄顯示 approver / decision / comment;尚未到的關卡顯示「等待中」。
 */
function ApprovalTimeline({
  chain,
  currentStep,
  status,
  approvals,
}: {
  chain: UserRole[];
  currentStep: UserRole | null;
  status: LeaveStatus;
  approvals: ApprovalRow[];
}) {
  const byRole = new Map<UserRole, ApprovalRow>();
  for (const a of approvals) byRole.set(a.step_role, a);

  return (
    <ol className="space-y-2">
      {chain.map((role) => {
        const a = byRole.get(role);
        const isCurrent = status === "pending" && currentStep === role;
        const isUntouched = !a && !isCurrent;

        let dotCls = "bg-[#E0DCD6] text-[#9B9590]";
        let stateLabel = "尚未開始";
        let tone: "muted" | "warning" | "success" | "danger" = "muted";

        if (a?.decision === "approved") {
          dotCls = "bg-[#ECFDF5] text-[#4A7C59] border border-[#A7F3D0]";
          stateLabel = "通過";
          tone = "success";
        } else if (a?.decision === "rejected") {
          dotCls = "bg-[#FEF2F2] text-[#B91C1C] border border-[#FCA5A5]";
          stateLabel = "退回";
          tone = "danger";
        } else if (isCurrent) {
          dotCls = "bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]";
          stateLabel = "等待簽核";
          tone = "warning";
        }

        return (
          <li
            key={role}
            className={`flex gap-3 rounded-md border p-3 ${
              isUntouched
                ? "border-dashed border-[#E0DCD6] bg-white"
                : "border-[#E0DCD6] bg-card"
            }`}
          >
            <span
              className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${dotCls}`}
              aria-hidden
            >
              {a?.decision === "approved"
                ? "✓"
                : a?.decision === "rejected"
                  ? "✕"
                  : isCurrent
                    ? "…"
                    : "·"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <div className="text-sm font-semibold text-foreground">
                  {ROLE_LABEL[role]}
                </div>
                <div className="text-xs text-muted-foreground">
                  {a ? formatTW(a.created_at) : ""}
                </div>
              </div>
              <div className={`mt-0.5 text-xs ${toneText(tone)}`}>
                {stateLabel}
                {a?.approver?.full_name && ` · ${a.approver.full_name}`}
              </div>
              {a?.comment && (
                <p className="mt-1.5 whitespace-pre-line rounded-md bg-[#FAF7F2] px-3 py-2 text-sm text-foreground">
                  {a.comment}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function toneText(t: "muted" | "warning" | "success" | "danger"): string {
  switch (t) {
    case "warning":
      return "text-[#D97706]";
    case "success":
      return "text-[#4A7C59]";
    case "danger":
      return "text-[#B91C1C]";
    default:
      return "text-muted-foreground";
  }
}
