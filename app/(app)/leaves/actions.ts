"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireRole, getActor } from "@/lib/auth/require-role";
import {
  canActOnLeave,
  canApplyLeave,
  getApprovalChain,
  hoursBetween,
  nextStep,
} from "@/lib/leave";
import { canBeProxy, canDesignateProxy, isLeaveOver } from "@/lib/leave-proxy";
import { isProxyFeatureReady } from "@/lib/logs/proxy";
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
  reason: z.string().trim().min(2, "請填請假事由（至少 2 個字）").max(500),
  // 代理人(migration-2.43,選填):工地主任請假期間代送施工日誌的現場人員
  proxy_id: z.union([z.literal(""), z.string().uuid("代理人選擇有誤")]),
});

/**
 * 代理人要是「在職的現場人員」、不能是自己。
 * 用 service role 查 — 主任讀不到別人的 profile(RLS)。回 null = 合格。
 */
async function validateProxy(proxyId: string, applicantId: string): Promise<string | null> {
  if (proxyId === applicantId) return "代理人不能選自己";
  const admin = createServiceClient();
  const { data } = await admin
    .from("profiles")
    .select("role, is_active")
    .eq("id", proxyId)
    .maybeSingle();
  if (!data || !data.is_active || !canBeProxy(data.role as UserRole)) {
    return "代理人要選在職的現場人員";
  }
  return null;
}

/** 代理人被換掉 / 取消時,通知原本的代理人(站內消息 + LINE,不阻塞) */
function announceProxyEnded(
  requestId: string,
  proxyId: string,
  reason: "cancelled" | "rejected" | "changed" | "removed",
  actorId: string,
) {
  after(async () => {
    const events = await import("@/lib/notifications/events");
    await Promise.all([
      events.messageLeaveProxyEnded(requestId, proxyId, reason, actorId),
      events.notifyLeaveProxyEnded(requestId, proxyId, reason),
    ]);
  });
}

/** 被指定為代理人 → 通知代理人本人(站內消息 + LINE,不阻塞) */
function announceProxyAssigned(requestId: string, actorId: string) {
  after(async () => {
    const events = await import("@/lib/notifications/events");
    await Promise.all([
      events.messageLeaveProxyAssigned(requestId, actorId),
      events.notifyLeaveProxyAssigned(requestId),
    ]);
  });
}

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
    return { ok: false, error: "您的角色沒有可簽核的上層，無法送請假" };
  }

  const raw = {
    leave_type: String(formData.get("leave_type") ?? ""),
    start_at: String(formData.get("start_at") ?? ""),
    end_at: String(formData.get("end_at") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    proxy_id: String(formData.get("proxy_id") ?? ""),
  };
  const parsed = SubmitSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("、"),
    };
  }
  const { leave_type, start_at, end_at, reason } = parsed.data;
  const proxyId = parsed.data.proxy_id || null;
  if (proxyId) {
    if (!canDesignateProxy(me.role)) {
      return { ok: false, error: "只有工地主任請假可以指定代理人" };
    }
    if (!(await isProxyFeatureReady())) {
      return { ok: false, error: "代理人功能還沒啟用，請先不選代理人送出" };
    }
    const proxyErr = await validateProxy(proxyId, me.id);
    if (proxyErr) return { ok: false, error: proxyErr };
  }

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
  // 用原始時間差比,不用四捨五入後的時數 — 資料庫的請假單守門(migration-2.43)也是這樣算,
  // 不然 30 天又幾分鐘會這裡放行、資料庫擋下
  if (new Date(endISO).getTime() - new Date(startISO).getTime() > 30 * 24 * 60 * 60 * 1000) {
    return { ok: false, error: "單次請假最多 30 天，請拆成多筆送出" };
  }

  const chain = getApprovalChain(me.role);
  const supabase = await createClient();

  const insertRow: Record<string, unknown> = {
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
  };
  // 沒選代理人就不帶這個 key — migration-2.43 還沒跑時一般請假照常送得出去
  if (proxyId) insertRow.proxy_id = proxyId;

  const { data, error } = await supabase
    .from("leave_requests")
    .insert(insertRow)
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: "送出失敗：" + (error?.message ?? "未知錯誤") };
  }

  // LINE 通知第一關簽核角色(不阻塞、失敗不影響請假)
  const newRequestId = data.id as string;
  after(async () => {
    const { notifyLeaveSubmitted } = await import("@/lib/notifications/events");
    await notifyLeaveSubmitted(newRequestId);
  });
  // 代理從送出就生效(不等核准)— 馬上讓代理人知道
  if (proxyId) announceProxyAssigned(newRequestId, me.id);

  revalidatePath("/leaves");
  return { ok: true, requestId: data.id as string };
}

const ApproveSchema = z.object({
  requestId: z.string().uuid(),
  comment: z.string().trim().max(500).optional(),
});

const RejectSchema = z.object({
  requestId: z.string().uuid(),
  comment: z.string().trim().min(2, "退回需要寫原因（至少 2 個字）").max(500),
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
    return { ok: false, error: "目前不是您的簽核關卡" };
  }

  const { error: insErr } = await supabase.from("leave_approvals").insert({
    request_id: req.id,
    step_role: me.role,
    approver_id: me.id,
    decision: "approved",
    comment: parsed.data.comment || null,
  });
  if (insErr) {
    return { ok: false, error: "寫入簽核紀錄失敗：" + insErr.message };
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
    return { ok: false, error: "更新狀態失敗：" + updErr.message };
  }

  // LINE 通知:還有下一關 → 通知該關角色;最後一關過 → 通知申請人已核准
  const requestId = req.id as string;
  after(async () => {
    const events = await import("@/lib/notifications/events");
    if (next) {
      await events.notifyLeaveAdvanced(requestId, next);
    } else {
      await events.notifyLeaveResolved(requestId, "approved");
    }
  });

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

  // select("*"):順便拿 proxy_id(migration-2.43 沒跑時沒有這欄,不能寫死欄名)
  const { data: req, error: readErr } = await supabase
    .from("leave_requests")
    .select("*")
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
    return { ok: false, error: "目前不是您的簽核關卡" };
  }

  const { error: insErr } = await supabase.from("leave_approvals").insert({
    request_id: req.id,
    step_role: me.role,
    approver_id: me.id,
    decision: "rejected",
    comment: parsed.data.comment,
  });
  if (insErr) {
    return { ok: false, error: "寫入簽核紀錄失敗：" + insErr.message };
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
    return { ok: false, error: "更新狀態失敗：" + updErr.message };
  }

  // LINE 通知申請人:請假被退回(附原因)
  const requestId = req.id as string;
  const rejectComment = parsed.data.comment;
  after(async () => {
    const { notifyLeaveResolved } = await import("@/lib/notifications/events");
    await notifyLeaveResolved(requestId, "rejected", rejectComment);
  });
  // 假單退回 → 代理跟著失效,告訴代理人不用再代寫
  const rejectedProxyId = (req.proxy_id as string | null | undefined) ?? null;
  if (rejectedProxyId) {
    announceProxyEnded(requestId, rejectedProxyId, "rejected", me.id);
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

  // select("*"):順便拿 proxy_id(migration-2.43 沒跑時沒有這欄,不能寫死欄名)
  const { data: req, error: readErr } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("id", input.requestId)
    .maybeSingle();
  if (readErr || !req) {
    return { ok: false, error: "找不到請假" };
  }
  if (req.applicant_id !== me.id) {
    return { ok: false, error: "只能取消自己送出的請假" };
  }
  if (req.status !== "pending") {
    return { ok: false, error: "已完成的請假無法取消" };
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
    return { ok: false, error: "取消失敗：" + updErr.message };
  }

  const cancelledProxyId = (req.proxy_id as string | null | undefined) ?? null;
  if (cancelledProxyId) {
    announceProxyEnded(req.id as string, cancelledProxyId, "cancelled", me.id);
  }

  revalidatePath("/leaves");
  revalidatePath(`/leaves/${req.id}`);
  return { ok: true };
}

const ProxySchema = z.object({
  requestId: z.string().uuid(),
  proxyId: z.string().uuid().nullable(),
});

/**
 * 更換 / 取消代理人(migration-2.43)。
 * - 誰能改:申請人本人(工地主任),或辦公室助理 / 老闆(主任臨時聯絡不上時幫忙指定)
 * - 什麼時候能改:假單還有效(簽核中 / 已核准)而且請假還沒結束
 * 原代理人收到「代理已取消」,新代理人收到「被指定」。
 */
export async function updateLeaveProxyAction(input: {
  requestId: string;
  proxyId: string | null;
}): Promise<ActionResult> {
  const parsed = ProxySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "代理人選擇有誤" };
  }
  const me = await requireRole(["site_supervisor", "office_staff", "owner"]);
  const supabase = await createClient();

  const { data: req, error: readErr } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("id", parsed.data.requestId)
    .maybeSingle();
  if (readErr || !req) {
    return { ok: false, error: "找不到請假" };
  }
  if (!("proxy_id" in req) || !(await isProxyFeatureReady())) {
    return { ok: false, error: "代理人功能還沒啟用（資料庫尚未更新），請聯絡系統管理員" };
  }
  const isApplicant = req.applicant_id === me.id;
  if (!isApplicant && me.role !== "office_staff" && me.role !== "owner") {
    return { ok: false, error: "只有請假的主任本人或辦公室可以改代理人" };
  }
  if (!canDesignateProxy(req.applicant_role as UserRole)) {
    return { ok: false, error: "只有工地主任的請假可以指定代理人" };
  }
  if (req.status !== "pending" && req.status !== "approved") {
    return { ok: false, error: "這張假單已退回或取消，不能再改代理人" };
  }
  if (isLeaveOver(req.end_at as string)) {
    return { ok: false, error: "請假已經結束，不能再改代理人" };
  }

  const nextProxy = parsed.data.proxyId;
  const prevProxy = (req.proxy_id as string | null) ?? null;
  if (nextProxy === prevProxy) return { ok: true };
  if (nextProxy) {
    const proxyErr = await validateProxy(nextProxy, req.applicant_id as string);
    if (proxyErr) return { ok: false, error: proxyErr };
  }

  // 條件式更新:讀完到寫入之間被退回 / 取消就不寫(看 rowcount — RLS 擋下也是 0 筆、沒有 error)
  const { data: updRows, error: updErr } = await supabase
    .from("leave_requests")
    .update({ proxy_id: nextProxy })
    .eq("id", req.id)
    .in("status", ["pending", "approved"])
    .select("id");
  if (updErr) {
    return { ok: false, error: "更新代理人失敗：" + updErr.message };
  }
  if (!updRows || updRows.length === 0) {
    return { ok: false, error: "假單狀態剛被變更，請重新整理後再試" };
  }

  const requestId = req.id as string;
  if (prevProxy) {
    announceProxyEnded(requestId, prevProxy, nextProxy ? "changed" : "removed", me.id);
  }
  if (nextProxy) announceProxyAssigned(requestId, me.id);

  revalidatePath("/leaves");
  revalidatePath(`/leaves/${requestId}`);
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
