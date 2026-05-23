"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, getActor } from "@/lib/auth/require-role";
import {
  canActOnLeave,
  canApplyLeave,
  getApprovalChain,
  hoursBetween,
  nextStep,
} from "@/lib/leave";
import type { LeaveType, UserRole } from "@/lib/types";

const LEAVE_TYPES = [
  "personal",
  "sick",
  "official",
  "annual",
  "menstrual",
  "bereavement",
  "marriage",
  "other",
] as const satisfies readonly LeaveType[];

const SubmitSchema = z.object({
  leave_type: z.enum(LEAVE_TYPES),
  start_at: z.string().min(1, "請選請假起始時間"),
  end_at: z.string().min(1, "請選請假結束時間"),
  reason: z.string().trim().min(2, "請填請假事由(至少 2 個字)").max(500),
});

export type SubmitResult =
  | { ok: true; requestId: string }
  | { ok: false; error: string };

/**
 * 送出請假申請。
 * - 自動依申請人 role 算 approval_chain;owner 不能送(沒上層可簽)。
 * - total_hours 由 server 算,前端不可改。
 */
export async function submitLeaveAction(formData: FormData): Promise<SubmitResult> {
  const me = await requireRole([
    "field_assistant",
    "site_supervisor",
    "office_staff",
  ]);

  if (!canApplyLeave(me.role)) {
    return { ok: false, error: "你的角色沒有可簽核的上層,無法送請假" };
  }

  const raw = {
    leave_type: String(formData.get("leave_type") ?? ""),
    start_at: String(formData.get("start_at") ?? ""),
    end_at: String(formData.get("end_at") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  };
  const parsed = SubmitSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("、"),
    };
  }
  const { leave_type, start_at, end_at, reason } = parsed.data;

  // 把 datetime-local 字串(沒帶時區)當台北時間轉成 UTC ISO
  const startISO = localInputToISO(start_at);
  const endISO = localInputToISO(end_at);
  if (!startISO || !endISO) {
    return { ok: false, error: "時間格式錯誤" };
  }
  const total = hoursBetween(startISO, endISO);
  if (total <= 0) {
    return { ok: false, error: "結束時間必須晚於起始時間" };
  }
  if (total > 24 * 30) {
    return { ok: false, error: "單次請假不能超過 30 天" };
  }

  const chain = getApprovalChain(me.role);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("leave_requests")
    .insert({
      applicant_id: me.id,
      applicant_role: me.role,
      leave_type,
      start_at: startISO,
      end_at: endISO,
      total_hours: total,
      reason,
      status: "pending",
      current_step: chain[0],
      approval_chain: chain,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: "送出失敗:" + (error?.message ?? "未知錯誤") };
  }

  revalidatePath("/leaves");
  return { ok: true, requestId: data.id as string };
}

const ApproveSchema = z.object({
  requestId: z.string().uuid(),
  comment: z.string().trim().max(500).optional(),
});

const RejectSchema = z.object({
  requestId: z.string().uuid(),
  comment: z.string().trim().min(2, "退回需要寫原因(至少 2 個字)").max(500),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * 通過當前關。
 * - 必須是 pending + current_step === 我的 role + 我不是申請人
 * - 推到下一關;若已是最後一關 → status='approved', resolved_at=now()
 */
export async function approveLeaveAction(input: {
  requestId: string;
  comment?: string;
}): Promise<ActionResult> {
  const parsed = ApproveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "輸入錯誤" };
  }
  const me = await requireRole(["site_supervisor", "office_staff", "owner"]);
  const supabase = await createClient();

  const { data: req, error: readErr } = await supabase
    .from("leave_requests")
    .select("id, applicant_id, status, current_step, approval_chain")
    .eq("id", parsed.data.requestId)
    .maybeSingle();
  if (readErr || !req) {
    return { ok: false, error: "找不到請假" };
  }
  if (
    !canActOnLeave(
      {
        applicant_id: req.applicant_id as string,
        status: req.status as "pending",
        current_step: req.current_step as UserRole | null,
      },
      me.role,
      me.id,
    )
  ) {
    return { ok: false, error: "目前不是你的簽核關卡" };
  }

  const { error: insErr } = await supabase.from("leave_approvals").insert({
    request_id: req.id,
    step_role: me.role,
    approver_id: me.id,
    decision: "approved",
    comment: parsed.data.comment || null,
  });
  if (insErr) {
    return { ok: false, error: "寫入簽核紀錄失敗:" + insErr.message };
  }

  const chain = (req.approval_chain as UserRole[]) ?? [];
  const next = nextStep(chain, me.role);
  const update = next
    ? { current_step: next }
    : {
        status: "approved",
        current_step: null,
        resolved_at: new Date().toISOString(),
      };

  const { error: updErr } = await supabase
    .from("leave_requests")
    .update(update)
    .eq("id", req.id);
  if (updErr) {
    return { ok: false, error: "更新狀態失敗:" + updErr.message };
  }

  revalidatePath("/leaves");
  revalidatePath(`/leaves/${req.id}`);
  return { ok: true };
}

/**
 * 退回(整份否決)。申請人要重送新的一份。
 */
export async function rejectLeaveAction(input: {
  requestId: string;
  comment: string;
}): Promise<ActionResult> {
  const parsed = RejectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "輸入錯誤" };
  }
  const me = await requireRole(["site_supervisor", "office_staff", "owner"]);
  const supabase = await createClient();

  const { data: req, error: readErr } = await supabase
    .from("leave_requests")
    .select("id, applicant_id, status, current_step, approval_chain")
    .eq("id", parsed.data.requestId)
    .maybeSingle();
  if (readErr || !req) {
    return { ok: false, error: "找不到請假" };
  }
  if (
    !canActOnLeave(
      {
        applicant_id: req.applicant_id as string,
        status: req.status as "pending",
        current_step: req.current_step as UserRole | null,
      },
      me.role,
      me.id,
    )
  ) {
    return { ok: false, error: "目前不是你的簽核關卡" };
  }

  const { error: insErr } = await supabase.from("leave_approvals").insert({
    request_id: req.id,
    step_role: me.role,
    approver_id: me.id,
    decision: "rejected",
    comment: parsed.data.comment,
  });
  if (insErr) {
    return { ok: false, error: "寫入簽核紀錄失敗:" + insErr.message };
  }

  const { error: updErr } = await supabase
    .from("leave_requests")
    .update({
      status: "rejected",
      current_step: null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", req.id);
  if (updErr) {
    return { ok: false, error: "更新狀態失敗:" + updErr.message };
  }

  revalidatePath("/leaves");
  revalidatePath(`/leaves/${req.id}`);
  return { ok: true };
}

/**
 * 申請人自行取消(僅限 pending)。
 */
export async function cancelLeaveAction(input: {
  requestId: string;
}): Promise<ActionResult> {
  const me = await getActor();
  const supabase = await createClient();

  const { data: req, error: readErr } = await supabase
    .from("leave_requests")
    .select("id, applicant_id, status")
    .eq("id", input.requestId)
    .maybeSingle();
  if (readErr || !req) {
    return { ok: false, error: "找不到請假" };
  }
  if (req.applicant_id !== me.id) {
    return { ok: false, error: "只能取消自己的請假" };
  }
  if (req.status !== "pending") {
    return { ok: false, error: "已完成的請假不能取消" };
  }

  const { error: updErr } = await supabase
    .from("leave_requests")
    .update({
      status: "cancelled",
      current_step: null,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", req.id);
  if (updErr) {
    return { ok: false, error: "取消失敗:" + updErr.message };
  }

  revalidatePath("/leaves");
  revalidatePath(`/leaves/${req.id}`);
  return { ok: true };
}

/**
 * datetime-local input 給的字串(YYYY-MM-DDTHH:mm)是「使用者本地」時間,
 * 沒帶時區。我們把它當「台北時間 UTC+8」處理,轉成正確的 UTC ISO 字串
 * 寫入 DB。(避免伺服器在 UTC 上 new Date 把它誤認為 UTC 時刻。)
 */
function localInputToISO(input: string): string | null {
  // 期望格式:2026-05-23T08:30  或 2026-05-23T08:30:00
  const m = input.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // 用 Date.UTC 計算「該本地時刻在 UTC 是幾點」:本地時間 - 8 小時 = UTC
  const utcMs = Date.UTC(+y, +mo - 1, +d, +h - 8, +mi, s ? +s : 0);
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
