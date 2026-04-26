"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  DailyLogManpower,
  DailyLogWorkItem,
  DailyLogExtraItem,
  DailyLogUnsignedItem,
} from "@/lib/types";

type SaveLogPayload = {
  logId?: string;        // 編輯時帶
  caseId: string;
  logDate: string;
  weather: string;
  manpower: DailyLogManpower;
  workItems: DailyLogWorkItem[];
  extraItems: DailyLogExtraItem[];
  unsignedItems: DailyLogUnsignedItem[];
  photos: string[];      // storage paths
  vendorNotices: string;
  notes: string;
  intent: "draft" | "submit";
  fillSignatureUrl?: string;  // 送出時必帶 — 填表人手寫簽名
};

export async function saveLogAction(payload: SaveLogPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登入" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "site_supervisor") {
    return { ok: false, error: "只有工地主任可以填寫日誌" };
  }

  if (!payload.caseId) return { ok: false, error: "請選案件" };
  if (!payload.logDate) return { ok: false, error: "請選日期" };
  const hasContent =
    payload.workItems.length > 0 ||
    payload.extraItems.length > 0 ||
    payload.unsignedItems.length > 0;
  if (payload.intent === "submit" && !hasContent) {
    return {
      ok: false,
      error: "送出前至少要填 1 個工項(主工項 / 合約外 / 未簽約 任一)",
    };
  }
  if (payload.intent === "submit" && !payload.fillSignatureUrl) {
    return { ok: false, error: "送出前請先簽名" };
  }

  // 四關正式流程:submit 時 status='submitted' + current_stage='review'(第一關)。
  // draft 時兩個欄位都 null。
  // 重送被退回的日誌(rejected → submit)也會回到 review 起點。
  const status = payload.intent === "submit" ? "submitted" : "draft";
  const currentStage = payload.intent === "submit" ? "review" : null;
  const submittedAt = payload.intent === "submit" ? new Date().toISOString() : null;

  let logId = payload.logId;

  if (logId) {
    // 更新既有
    const { error } = await supabase
      .from("daily_logs")
      .update({
        case_id: payload.caseId,
        log_date: payload.logDate,
        weather: payload.weather || null,
        manpower: payload.manpower,
        work_items: payload.workItems,
        extra_items: payload.extraItems,
        unsigned_items: payload.unsignedItems,
        photos: payload.photos,
        vendor_notices: payload.vendorNotices || null,
        notes: payload.notes || null,
        status,
        current_stage: currentStage,
        submitted_at: submittedAt ?? undefined,
      })
      .eq("id", logId)
      .eq("supervisor_id", user.id);
    if (error) return { ok: false, error: "儲存失敗:" + error.message };
  } else {
    const { data, error } = await supabase
      .from("daily_logs")
      .insert({
        case_id: payload.caseId,
        supervisor_id: user.id,
        log_date: payload.logDate,
        weather: payload.weather || null,
        manpower: payload.manpower,
        work_items: payload.workItems,
        extra_items: payload.extraItems,
        unsigned_items: payload.unsignedItems,
        photos: payload.photos,
        vendor_notices: payload.vendorNotices || null,
        notes: payload.notes || null,
        status,
        current_stage: currentStage,
        submitted_at: submittedAt,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "建立失敗:" + error?.message };
    logId = data.id;
  }

  // ⚠ Phase 2.3 起取消 auto-pass。三關都要對應角色的人手動點通過。
  // Phase 2.5:送出時填表人也要簽名 → 寫一筆 stage='fill' 的 log_approvals 紀錄,
  // 跟其他三關一致地進入 PDF 簽核紀錄區。重送被退回的日誌也會再寫一筆。
  if (payload.intent === "submit" && payload.fillSignatureUrl && logId) {
    const { error: sigErr } = await supabase.from("log_approvals").insert({
      log_id: logId,
      stage: "fill",
      approver_id: user.id,
      decision: "approved",
      signature_url: payload.fillSignatureUrl,
    });
    if (sigErr) return { ok: false, error: "簽名儲存失敗:" + sigErr.message };
  }

  revalidatePath("/logs");
  revalidatePath(`/logs/${logId}`);
  revalidatePath("/approvals");

  return { ok: true, logId };
}

export async function deleteLogAction(formData: FormData) {
  const logId = String(formData.get("logId") ?? "");
  if (!logId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "site_supervisor") return;
  // 只能刪自己的草稿
  await supabase
    .from("daily_logs")
    .delete()
    .eq("id", logId)
    .eq("supervisor_id", user.id)
    .eq("status", "draft");
  revalidatePath("/logs");
  redirect("/logs");
}
