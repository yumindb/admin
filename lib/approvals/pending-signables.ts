import type { SupabaseClient } from "@supabase/supabase-js";
import { findApproveSignedLogIds } from "@/lib/approvals/dual-sign";
import type { ApprovalStage, LeaveType, UserRole } from "@/lib/types";

/**
 * 「現在等這個人簽」的文件清單(消息頁用,2026-08-06)。
 *
 * 業主要求消息頁也要看得到「該我簽的」,而且**簽完就消失**。
 * 待簽是狀態不是事件 — 所以不寫進 app_messages(事件式通知還要配對刪除,
 * 批簽 / 退回 / 撤回每條路都得記得清,漏一條就殘留假通知),
 * 而是每次進頁面即時查:日誌停在我這關 + 請假輪到我簽。
 * 簽掉之後 status / current_stage 一變,下次 render 自然就不在了。
 *
 * 查詢條件刻意跟 /approvals 頁與 layout 的 badge 完全同一套
 * (含核定關雙簽「我簽過的先不顯示」的過濾),三個地方數字才會對得起來。
 */

const STAGE_FOR_ROLE: Record<UserRole, ApprovalStage | null> = {
  site_supervisor: "review",
  office_staff: "audit",
  owner: "approve",
  field_assistant: null,
};

/** 消息頁一次最多列這麼多份 — 再多就該去 /approvals 用批簽清 */
const LIST_LIMIT = 50;

export type PendingSignableLog = {
  id: string;
  log_date: string;
  caseName: string | null;
  caseCode: string | null;
  supervisorName: string | null;
};

export type PendingSignableLeave = {
  id: string;
  leave_type: LeaveType;
  start_at: string;
  end_at: string;
  total_hours: number;
  applicantName: string | null;
};

export type PendingSignables = {
  /** 這個角色簽的是哪一關(field_assistant 為 null,兩個清單必為空) */
  stage: ApprovalStage | null;
  logs: PendingSignableLog[];
  leaves: PendingSignableLeave[];
};

type LogRow = {
  id: string;
  log_date: string;
  submitted_at: string | null;
  cases: { name: string; code: string | null } | null;
  profiles: { full_name: string } | null;
};

type LeaveRow = {
  id: string;
  leave_type: LeaveType;
  start_at: string;
  end_at: string;
  total_hours: number;
  applicant: { full_name: string } | null;
};

/**
 * 等 actor 簽核的日誌 + 請假。查詢失敗回空清單 — 消息頁的主角是消息,
 * 待簽區塊掛了不能把整頁拖下水(規則同 listMessages)。
 */
export async function listPendingSignables(
  supabase: SupabaseClient,
  actor: { id: string; role: UserRole },
): Promise<PendingSignables> {
  const stage = STAGE_FOR_ROLE[actor.role] ?? null;

  const logsPromise = stage
    ? (() => {
        let q = supabase
          .from("daily_logs")
          .select(
            "id, log_date, submitted_at, cases(name, code), profiles!daily_logs_supervisor_id_fkey(full_name)",
          )
          .eq("status", "submitted")
          .eq("current_stage", stage)
          .order("submitted_at", { ascending: true })
          .limit(LIST_LIMIT);
        // supervisor 只複核自己的日誌(同 /approvals)
        if (actor.role === "site_supervisor") {
          q = q.eq("supervisor_id", actor.id);
        }
        return q;
      })()
    : null;

  const leavesPromise = stage
    ? supabase
        .from("leave_requests")
        .select(
          "id, leave_type, start_at, end_at, total_hours, applicant:profiles!applicant_id(full_name)",
        )
        .eq("status", "pending")
        .eq("current_step", actor.role)
        .neq("applicant_id", actor.id)
        .order("submitted_at", { ascending: true })
        .limit(LIST_LIMIT)
    : null;

  const [logsRes, leavesRes] = await Promise.all([logsPromise, leavesPromise]);

  if (logsRes?.error) {
    console.error("[messages] 待簽日誌查詢失敗:", logsRes.error.message);
  }
  if (leavesRes?.error) {
    console.error("[messages] 待簽請假查詢失敗:", leavesRes.error.message);
  }

  let logRows = (logsRes?.data ?? []) as unknown as LogRow[];

  // 核定關雙簽:這一輪我已簽過的不算「等我簽」(在等的是另一位核定人)
  if (stage === "approve" && logRows.length > 0) {
    const signed = await findApproveSignedLogIds(
      supabase,
      actor.id,
      logRows.map((l) => ({ id: l.id, submitted_at: l.submitted_at })),
    );
    logRows = logRows.filter((l) => !signed.has(l.id));
  }

  return {
    stage,
    logs: logRows.map((l) => ({
      id: l.id,
      log_date: l.log_date,
      caseName: l.cases?.name ?? null,
      caseCode: l.cases?.code ?? null,
      supervisorName: l.profiles?.full_name ?? null,
    })),
    leaves: ((leavesRes?.data ?? []) as unknown as LeaveRow[]).map((r) => ({
      id: r.id,
      leave_type: r.leave_type,
      start_at: r.start_at,
      end_at: r.end_at,
      total_hours: r.total_hours,
      applicantName: r.applicant?.full_name ?? null,
    })),
  };
}
