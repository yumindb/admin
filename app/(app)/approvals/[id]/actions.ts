"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePdfForLog } from "@/lib/pdf/generate";
import type { ApprovalStage, UserRole } from "@/lib/types";

/**
 * 四關正式簽核流(Phase 2.3 起,Phase 2.5 起每關都收簽名):
 *   stage='fill'    → site_supervisor 送出時即簽(寫在 saveLogAction)
 *   stage='review'  → site_supervisor(主任複核,可自核)
 *   stage='audit'   → office_staff(辦公室助理審核)
 *   stage='approve' → owner(老闆核定)
 *
 * 規則:
 *   - 操作者的 role 必須對應當前 stage(role-stage map 見下方),否則拒絕
 *   - review / audit / approve 三關都要附簽名圖(2.5 起統一)
 *   - 通過 → 推進到下一 stage(approve 通過則 status='approved' + current_stage=null)
 *   - 退回 → status='rejected' + current_stage=null,supervisor 編輯後重送回 review
 */

const STAGE_FOR_ROLE: Record<UserRole, ApprovalStage | null> = {
  site_supervisor: "review",
  office_staff: "audit",
  owner: "approve",
  field_assistant: null,
};

const NEXT_STAGE: Record<ApprovalStage, ApprovalStage | null> = {
  review: "audit",
  audit: "approve",
  approve: null,           // owner approves → done
};

type ActPayload = {
  logId: string;
  signatureUrl?: string;   // approveStageAction 必填(每關都要簽);rejectStageAction 不需要
  comment?: string;        // 退回必填,通過可選
};

async function getActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, role: null as UserRole | null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return { supabase, user, role: (profile?.role ?? null) as UserRole | null };
}

async function loadLogStage(supabase: Awaited<ReturnType<typeof createClient>>, logId: string) {
  const { data } = await supabase
    .from("daily_logs")
    .select("status, current_stage")
    .eq("id", logId)
    .maybeSingle();
  return data as { status: string; current_stage: ApprovalStage | null } | null;
}

/**
 * 通過當前關卡。每關都要帶 signatureUrl。
 */
export async function approveStageAction(payload: ActPayload) {
  const { supabase, user, role } = await getActor();
  if (!user || !role) return { ok: false as const, error: "未登入" };

  const log = await loadLogStage(supabase, payload.logId);
  if (!log) return { ok: false as const, error: "找不到日誌" };
  if (log.status !== "submitted" || !log.current_stage) {
    return { ok: false as const, error: "此日誌不在簽核中" };
  }

  const allowedStage = STAGE_FOR_ROLE[role];
  if (allowedStage !== log.current_stage) {
    return {
      ok: false as const,
      error: "你的角色不負責當前關卡",
    };
  }

  if (!payload.signatureUrl) {
    return { ok: false as const, error: "請先簽名" };
  }

  // 寫 approval 紀錄
  const { error: insErr } = await supabase.from("log_approvals").insert({
    log_id: payload.logId,
    stage: log.current_stage,
    approver_id: user.id,
    decision: "approved",
    comment: payload.comment?.trim() || null,
    signature_url: payload.signatureUrl ?? null,
  });
  if (insErr) return { ok: false as const, error: "寫入失敗:" + insErr.message };

  // 推進 status / current_stage
  const nextStage = NEXT_STAGE[log.current_stage];
  if (nextStage === null) {
    // 老闆核定通過
    await supabase
      .from("daily_logs")
      .update({ status: "approved", current_stage: null })
      .eq("id", payload.logId);

    // 核定通過 → 背景產 PDF（不阻塞 response）
    after(async () => {
      const res = await generatePdfForLog(payload.logId);
      if (!res.ok) {
        console.error("[approveStageAction] PDF gen failed:", res.error);
      }
    });
  } else {
    await supabase
      .from("daily_logs")
      .update({ current_stage: nextStage })
      .eq("id", payload.logId);
  }

  revalidatePath("/approvals");
  revalidatePath(`/logs/${payload.logId}`);
  return { ok: true as const };
}

/**
 * 退回當前關卡。任一關退回 → status='rejected' + current_stage=null。
 * supervisor 編輯後重送會回到 review。
 */
export async function rejectStageAction(payload: ActPayload) {
  const { supabase, user, role } = await getActor();
  if (!user || !role) return { ok: false as const, error: "未登入" };
  if (!payload.comment?.trim())
    return { ok: false as const, error: "退回需要填原因" };

  const log = await loadLogStage(supabase, payload.logId);
  if (!log) return { ok: false as const, error: "找不到日誌" };
  if (log.status !== "submitted" || !log.current_stage) {
    return { ok: false as const, error: "此日誌不在簽核中" };
  }

  const allowedStage = STAGE_FOR_ROLE[role];
  if (allowedStage !== log.current_stage) {
    return { ok: false as const, error: "你的角色不負責當前關卡" };
  }

  const { error: insErr } = await supabase.from("log_approvals").insert({
    log_id: payload.logId,
    stage: log.current_stage,
    approver_id: user.id,
    decision: "rejected",
    comment: payload.comment.trim(),
    signature_url: payload.signatureUrl ?? null,
  });
  if (insErr) return { ok: false as const, error: "寫入失敗:" + insErr.message };

  await supabase
    .from("daily_logs")
    .update({ status: "rejected", current_stage: null })
    .eq("id", payload.logId);

  revalidatePath("/approvals");
  revalidatePath(`/logs/${payload.logId}`);
  return { ok: true as const };
}

/**
 * 簽完一份後跳到下一份「同 stage 由我負責」的待簽核。
 * 沒下一份就回 /approvals 列表。
 */
export async function nextPendingRedirect(currentLogId: string) {
  const { supabase, user, role } = await getActor();
  if (!user || !role) redirect("/logs");
  const allowedStage = STAGE_FOR_ROLE[role];
  if (!allowedStage) redirect("/logs");

  const { data } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("status", "submitted")
    .eq("current_stage", allowedStage)
    .neq("id", currentLogId)
    .order("submitted_at", { ascending: true })
    .limit(1);
  if (data && data.length > 0) {
    redirect(`/approvals/${data[0].id}`);
  }
  redirect("/approvals");
}
