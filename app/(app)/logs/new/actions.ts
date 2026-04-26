"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { DailyLogManpower, DailyLogWorkItem } from "@/lib/types";

type SaveLogPayload = {
  logId?: string;        // 編輯時帶
  caseId: string;
  logDate: string;
  weather: string;
  manpower: DailyLogManpower;
  workItems: DailyLogWorkItem[];
  photos: string[];      // storage paths
  notes: string;
  intent: "draft" | "submit";
};

export async function saveLogAction(payload: SaveLogPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "未登入" };

  if (!payload.caseId) return { ok: false, error: "請選案件" };
  if (!payload.logDate) return { ok: false, error: "請選日期" };
  if (payload.intent === "submit" && payload.workItems.length === 0) {
    return { ok: false, error: "送出前至少要選 1 個工項" };
  }

  const status = payload.intent === "submit" ? "submitted" : "draft";
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
        photos: payload.photos,
        notes: payload.notes || null,
        status,
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
        photos: payload.photos,
        notes: payload.notes || null,
        status,
        submitted_at: submittedAt,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "建立失敗:" + error?.message };
    logId = data.id;
  }

  // POC 簡化:送出時自動寫 review + audit 兩關 auto-pass
  if (payload.intent === "submit") {
    await supabase.from("log_approvals").insert([
      {
        log_id: logId,
        stage: "review",
        approver_id: user.id, // POC: 自核
        decision: "approved",
        comment: "POC 階段 review 自動通過",
      },
      {
        log_id: logId,
        stage: "audit",
        approver_id: null,
        decision: "approved",
        comment: "POC 階段 audit 自動通過",
      },
    ]);
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
