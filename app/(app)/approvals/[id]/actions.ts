"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePdfForLog } from "@/lib/pdf/generate";
import type { ApprovalStage, UserRole } from "@/lib/types";

/**
 * 三關正式簽核流(Phase 2.3 起,Phase 2.5 起每關都收簽名):
 *   stage='fill'    → site_supervisor 送出時即簽(寫在 saveLogAction)
 *   stage='audit'   → office_staff(辦公室助理審核)   ← fill 後直接進這關
 *   stage='approve' → owner(老闆核定)
 *
 *   stage='review' 保留於 type / STAGE_FOR_ROLE / NEXT_STAGE 但目前未啟用。
 *   若未來需要加回主任複核關,只要:
 *     1. saveLogAction 的 currentStage 改回 'review'
 *     2. 下方 NEXT_STAGE fill 改回 'review'
 *   不需要修改其他邏輯。
 *
 * 規則:
 *   - 操作者的 role 必須對應當前 stage(role-stage map 見下方),否則拒絕
 *   - audit / approve 兩關都要附簽名圖
 *   - 通過 → 推進到下一 stage(approve 通過則 status='approved' + current_stage=null)
 *   - 退回 → status='rejected' + current_stage=null,supervisor 編輯後重送回 audit
 */

const STAGE_FOR_ROLE: Record<UserRole, ApprovalStage | null> = {
  site_supervisor: "review", // review 目前未啟用；改回三關時此值生效
  office_staff: "audit",
  owner: "approve",
  field_assistant: null,
};

const NEXT_STAGE: Record<ApprovalStage, ApprovalStage | null> = {
  fill: "audit",           // 三關流：fill → 直接進 audit（略過 review）
  review: "audit",         // 保留：若啟用四關時 review → audit
  audit: "approve",
  approve: null,           // owner approves → done
};

type ActPayload = {
  logId: string;
  signatureUrl?: string;   // approveStageAction 必填（每關都要簽）；rejectStageAction 不需要
  comment?: string;        // 退回必填，通過可選
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
export async function approveStageAction(
  payload: ActPayload,
  // 內部參數:批簽(batchApproveAction)逐筆呼叫時抑制單筆 LINE 通知,
  // 改由批次結束後送彙總通知(省官方帳號訊息額度)。client 端不會帶。
  internal?: { suppressNotify?: boolean },
) {
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
      error: "您的角色不負責當前關卡",
    };
  }

  if (!payload.signatureUrl) {
    return { ok: false as const, error: "請先簽名" };
  }

  // 寫入順序:先 conditional update 日誌 → 成功才寫 approval 紀錄。
  // (1) Race 守護:兩個簽核者同時點,只有第一個 UPDATE 成功推進 stage;
  //     第二個 0 rows,直接 return,不會留下孤兒 approval 紀錄。
  // (2) Retry 守護:網路失敗使用者重點,第二次 UPDATE 也 0 rows(stage 已推進),
  //     不會寫第二筆 approval。
  const nextStage = NEXT_STAGE[log.current_stage];
  const expectedStage = log.current_stage;
  if (nextStage === null) {
    // 老闆核定通過 — 同時把 pdf_status 翻 'generating',讓 UI 顯示「產生中…」
    const { data: rows, error: updErr } = await supabase
      .from("daily_logs")
      .update({
        status: "approved",
        current_stage: null,
        pdf_status: "generating",
        pdf_error: null,
      })
      .eq("id", payload.logId)
      .eq("status", "submitted")
      .eq("current_stage", expectedStage)
      .select("id");
    if (updErr) return { ok: false as const, error: "更新失敗：" + updErr.message };
    if (!rows || rows.length === 0) {
      return {
        ok: false as const,
        error: "日誌狀態已被他人變更，請重新整理",
      };
    }

    // 核定通過 → 背景產 PDF(不阻塞 response)。
    // 完成 / 失敗都要寫回 pdf_status,讓 UI 從 spinner 切到下載 / 重試。
    // 用 service-role 避免被 daily_logs RLS 擋(after() 跑在 user session 之後,
    // user 可能已登出 / token 過期)。
    after(async () => {
      const { createServiceClient } = await import("@/lib/supabase/server");
      const service = createServiceClient();
      try {
        const res = await generatePdfForLog(payload.logId);
        if (res.ok) {
          await service
            .from("daily_logs")
            .update({ pdf_status: "done", pdf_error: null })
            .eq("id", payload.logId);
        } else {
          console.error("[approveStageAction] PDF gen failed:", res.error);
          await service
            .from("daily_logs")
            .update({ pdf_status: "failed", pdf_error: res.error })
            .eq("id", payload.logId);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[approveStageAction] PDF gen threw:", msg);
        await service
          .from("daily_logs")
          .update({ pdf_status: "failed", pdf_error: msg })
          .eq("id", payload.logId);
      }
    });
  } else {
    const { data: rows, error: updErr } = await supabase
      .from("daily_logs")
      .update({ current_stage: nextStage })
      .eq("id", payload.logId)
      .eq("status", "submitted")
      .eq("current_stage", expectedStage)
      .select("id");
    if (updErr) return { ok: false as const, error: "更新失敗：" + updErr.message };
    if (!rows || rows.length === 0) {
      return {
        ok: false as const,
        error: "日誌狀態已被他人變更，請重新整理",
      };
    }
  }

  // UPDATE 已確保 stage 推進(這個請求是「贏家」),才寫 approval 紀錄。
  // 若這裡失敗,日誌已推進但 audit trail 缺一筆 — log 出來給管理者,後續可補。
  const { error: insErr } = await supabase.from("log_approvals").insert({
    log_id: payload.logId,
    stage: expectedStage,
    approver_id: user.id,
    decision: "approved",
    comment: payload.comment?.trim() || null,
    signature_url: payload.signatureUrl ?? null,
  });
  if (insErr) {
    console.error(
      "[approveStageAction] approval insert failed AFTER log advanced:",
      { logId: payload.logId, stage: expectedStage, err: insErr.message },
    );
  }

  // LINE 通知(不阻塞、失敗不影響簽核):
  //   audit 過關 → 通知老闆待核定;老闆核定通過 → 通知主任
  if (!internal?.suppressNotify) {
    after(async () => {
      const events = await import("@/lib/notifications/events");
      if (nextStage === null) {
        await events.notifyLogApproved(payload.logId);
      } else if (nextStage === "approve") {
        await events.notifyLogAwaitingApproval(payload.logId);
      }
    });
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
    return { ok: false as const, error: "您的角色不負責當前關卡" };
  }

  // 寫入順序同 approveStageAction:先 conditional update → 成功才寫 approval 紀錄。
  const expectedStage = log.current_stage;
  const { data: rows, error: updErr } = await supabase
    .from("daily_logs")
    .update({ status: "rejected", current_stage: null })
    .eq("id", payload.logId)
    .eq("status", "submitted")
    .eq("current_stage", expectedStage)
    .select("id");
  if (updErr) return { ok: false as const, error: "更新失敗：" + updErr.message };
  if (!rows || rows.length === 0) {
    return {
      ok: false as const,
      error: "日誌狀態已被他人變更，請重新整理",
    };
  }

  const { error: insErr } = await supabase.from("log_approvals").insert({
    log_id: payload.logId,
    stage: expectedStage,
    approver_id: user.id,
    decision: "rejected",
    comment: payload.comment.trim(),
    signature_url: payload.signatureUrl ?? null,
  });
  if (insErr) {
    console.error(
      "[rejectStageAction] approval insert failed AFTER log rejected:",
      { logId: payload.logId, stage: expectedStage, err: insErr.message },
    );
  }

  // LINE 通知主任:日誌被退回(附原因)
  const rejectComment = payload.comment.trim();
  after(async () => {
    const { notifyLogRejected } = await import("@/lib/notifications/events");
    await notifyLogRejected(payload.logId, rejectComment);
  });

  revalidatePath("/approvals");
  revalidatePath(`/logs/${payload.logId}`);
  return { ok: true as const };
}

/**
 * 批簽:對多個 logId 套用同一張簽名(signatureUrl)逐筆呼叫單筆 approve 邏輯。
 * 每筆都走原本的 conditional update 守 race condition,逐筆紀錄成功 / 失敗。
 *
 * 注意:
 *  - signatureUrl 由 client 先呼叫 uploadSignatureAction 上傳一次後拿到的 signed URL。
 *    每筆 log_approvals 共用同一張(URL 內含 storage path,getSignedUrls 會抽 path 重新籤)。
 *  - 4-concurrency 限流,避免同時打 DB 太多 / cancellable PDF after() 累積過多。
 *  - 任一筆失敗不中斷其他筆,失敗逐筆收集回傳。
 *  - 老闆關卡(approve)若有筆通過,各自會排背景 PDF 任務(after()),這部分由
 *    單筆 approveStageAction 處理。
 */
export async function batchApproveAction(payload: {
  logIds: string[];
  signatureUrl: string;
  comment?: string;
}): Promise<{
  ok: string[];
  failed: { logId: string; reason: string }[];
}> {
  const { logIds, signatureUrl, comment } = payload;
  const okList: string[] = [];
  const failed: { logId: string; reason: string }[] = [];

  if (!Array.isArray(logIds) || logIds.length === 0) {
    return { ok: okList, failed };
  }
  if (!signatureUrl) {
    // 整批拒絕:沒簽名
    return {
      ok: okList,
      failed: logIds.map((id) => ({ logId: id, reason: "缺簽名" })),
    };
  }

  // 4-concurrency worker pool(W4-1 同模式)
  const concurrency = Math.min(4, logIds.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= logIds.length) return;
      const id = logIds[i];
      try {
        const res = await approveStageAction(
          {
            logId: id,
            signatureUrl,
            comment,
          },
          // 批簽抑制單筆通知,批完送彙總(見下方)
          { suppressNotify: true },
        );
        if (res.ok) {
          okList.push(id);
        } else {
          failed.push({ logId: id, reason: res.error });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failed.push({ logId: id, reason: msg });
      }
    }
  });
  await Promise.all(workers);

  // 批簽彙總通知:一批只送一則(而不是 N 則),省官方帳號訊息額度。
  //   office_staff 批審核 → 通知老闆「N 份待核定」
  //   owner 批核定 → 依主任分組,各通知「你的 N 份已核定」
  if (okList.length > 0) {
    const { role } = await getActor();
    const approvedIds = [...okList];
    after(async () => {
      const events = await import("@/lib/notifications/events");
      if (role === "office_staff") {
        await events.notifyLogsBatchAwaitingApproval(approvedIds.length);
      } else if (role === "owner") {
        await events.notifyLogsBatchApproved(approvedIds);
      }
    });
  }

  return { ok: okList, failed };
}

// ---------- 卡住日誌強制處理 (見 migration-2.24) ----------
// 卡 ≥ 7 天 → 老闆 / 辦公室助理可「強制退回填表人」(規避 role-stage 對應)
// 卡 ≥ 30 天 → 老闆 / 辦公室助理可「直接刪除整份日誌」(audit trigger 留證)
const FORCE_REJECT_MIN_DAYS = 7;
const FORCE_DELETE_MIN_DAYS = 30;

function stuckDays(submittedAt: string | null): number | null {
  if (!submittedAt) return null;
  const ms = Date.now() - new Date(submittedAt).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * 強制退回卡住的日誌(老闆 / 辦公室助理 only,卡 ≥ 7 天才開放)。
 * 不檢查 role 是否對應當前 stage,直接退到 'rejected'。
 * 寫一筆 log_approvals 記錄(stage 用日誌當前 stage,comment 前綴強制標記)。
 */
export async function forceRejectStuckLogAction(payload: {
  logId: string;
  comment: string;
}) {
  const { supabase, user, role } = await getActor();
  if (!user || !role) return { ok: false as const, error: "未登入" };
  if (role !== "office_staff" && role !== "owner") {
    return { ok: false as const, error: "只有辦公室助理或老闆可強制處理" };
  }
  const reason = payload.comment?.trim();
  if (!reason) return { ok: false as const, error: "請填強制退回原因" };

  const { data: log } = await supabase
    .from("daily_logs")
    .select("status, current_stage, submitted_at")
    .eq("id", payload.logId)
    .maybeSingle();
  if (!log) return { ok: false as const, error: "找不到日誌" };
  if (log.status !== "submitted" || !log.current_stage) {
    return { ok: false as const, error: "此日誌不在簽核中" };
  }
  const days = stuckDays(log.submitted_at);
  if (days === null || days < FORCE_REJECT_MIN_DAYS) {
    return {
      ok: false as const,
      error: `日誌卡住未滿 ${FORCE_REJECT_MIN_DAYS} 天,請先請對應角色處理`,
    };
  }

  const expectedStage = log.current_stage;
  const { data: rows, error: updErr } = await supabase
    .from("daily_logs")
    .update({ status: "rejected", current_stage: null })
    .eq("id", payload.logId)
    .eq("status", "submitted")
    .eq("current_stage", expectedStage)
    .select("id");
  if (updErr) return { ok: false as const, error: "更新失敗:" + updErr.message };
  if (!rows || rows.length === 0) {
    return { ok: false as const, error: "日誌狀態已被他人變更,請重新整理" };
  }

  const { error: insErr } = await supabase.from("log_approvals").insert({
    log_id: payload.logId,
    stage: expectedStage,
    approver_id: user.id,
    decision: "rejected",
    comment: `[強制退回·卡 ${days} 天] ${reason}`,
    signature_url: null,
  });
  if (insErr) {
    console.error(
      "[forceRejectStuckLogAction] approval insert failed AFTER log rejected:",
      { logId: payload.logId, err: insErr.message },
    );
  }

  // LINE 通知主任:日誌被強制退回(附原因)
  after(async () => {
    const { notifyLogRejected } = await import("@/lib/notifications/events");
    await notifyLogRejected(payload.logId, reason, { forced: true });
  });

  revalidatePath("/approvals");
  revalidatePath(`/logs/${payload.logId}`);
  return { ok: true as const };
}

/**
 * 強制刪除卡住的日誌(老闆 / 辦公室助理 only,卡 ≥ 30 天才開放)。
 * audit trigger 會自動寫 audit_logs(before_values 含整筆 daily_log JSON)。
 * cascade delete:log_approvals / daily_log_revisions 一併刪除。
 * 照片 / PDF 不另刪 — 走每日 cleanup-orphan-photos cron 自動清。
 */
export async function forceDeleteStuckLogAction(payload: { logId: string }) {
  const { supabase, user, role } = await getActor();
  if (!user || !role) return { ok: false as const, error: "未登入" };
  if (role !== "office_staff" && role !== "owner") {
    return { ok: false as const, error: "只有辦公室助理或老闆可強制刪除" };
  }

  const { data: log } = await supabase
    .from("daily_logs")
    .select("status, current_stage, submitted_at")
    .eq("id", payload.logId)
    .maybeSingle();
  if (!log) return { ok: false as const, error: "找不到日誌" };
  if (log.status !== "submitted" || !log.current_stage) {
    return { ok: false as const, error: "此日誌不在簽核中" };
  }
  const days = stuckDays(log.submitted_at);
  if (days === null || days < FORCE_DELETE_MIN_DAYS) {
    return {
      ok: false as const,
      error: `日誌卡住未滿 ${FORCE_DELETE_MIN_DAYS} 天,請先試「強制退回」`,
    };
  }

  const { error: delErr } = await supabase
    .from("daily_logs")
    .delete()
    .eq("id", payload.logId);
  if (delErr) return { ok: false as const, error: "刪除失敗:" + delErr.message };

  revalidatePath("/approvals");
  revalidatePath("/logs");
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

/**
 * 取得當前角色「還剩多少份待簽」— 給 client 端 toast 顯示「已簽 + 還剩 N 份」用。
 * 不重定向。傳入 currentLogId 會排除掉那筆。
 */
export async function getPendingCount(currentLogId?: string): Promise<number> {
  const { supabase, user, role } = await getActor();
  if (!user || !role) return 0;
  const allowedStage = STAGE_FOR_ROLE[role];
  if (!allowedStage) return 0;

  let q = supabase
    .from("daily_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "submitted")
    .eq("current_stage", allowedStage);
  // supervisor 看自己;owner / office_staff 看全公司
  if (role === "site_supervisor") q = q.eq("supervisor_id", user.id);
  if (currentLogId) q = q.neq("id", currentLogId);
  const { count } = await q;
  return count ?? 0;
}
