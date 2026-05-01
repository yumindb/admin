"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { FieldReportPhoto, UserRole } from "@/lib/types";

const REPORTERS: UserRole[] = ["field_assistant", "site_supervisor", "owner"];

async function requireReporter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "未登入" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !REPORTERS.includes(profile.role as UserRole)) {
    return { ok: false as const, error: "沒有權限上傳現場回報" };
  }
  return { ok: true as const, supabase, userId: user.id, role: profile.role as UserRole };
}

type ReportPayload = {
  caseId: string;
  note: string;
  photos: FieldReportPhoto[];
};

export async function createFieldReportAction(payload: ReportPayload) {
  const ctx = await requireReporter();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { supabase, userId } = ctx;

  if (!payload.caseId) return { ok: false, error: "請選案場" };
  const trimmedNote = payload.note.trim();
  if (!trimmedNote && payload.photos.length === 0) {
    return { ok: false, error: "至少要寫文字或加照片" };
  }

  const { data, error } = await supabase
    .from("field_reports")
    .insert({
      case_id: payload.caseId,
      author_id: userId,
      note: trimmedNote || null,
      photos: payload.photos,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "儲存失敗:" + (error?.message ?? "unknown") };
  }

  revalidatePath("/field-reports");
  revalidatePath("/logs/new");
  return { ok: true, reportId: data.id as string };
}

export async function updateFieldReportAction(payload: ReportPayload & { reportId: string }) {
  const ctx = await requireReporter();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { supabase, userId } = ctx;

  if (!payload.reportId) return { ok: false, error: "缺少回報編號" };
  if (!payload.caseId) return { ok: false, error: "請選案場" };
  const trimmedNote = payload.note.trim();
  if (!trimmedNote && payload.photos.length === 0) {
    return { ok: false, error: "至少要寫文字或加照片" };
  }

  // 只能改自己的 pending
  const { data: existing } = await supabase
    .from("field_reports")
    .select("author_id, status")
    .eq("id", payload.reportId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "找不到回報" };
  if (existing.author_id !== userId) {
    return { ok: false, error: "只能改自己的回報" };
  }
  if (existing.status !== "pending") {
    return { ok: false, error: "已合併或封存的回報不能改" };
  }

  const { error } = await supabase
    .from("field_reports")
    .update({
      case_id: payload.caseId,
      note: trimmedNote || null,
      photos: payload.photos,
    })
    .eq("id", payload.reportId);
  if (error) return { ok: false, error: "更新失敗:" + error.message };

  revalidatePath("/field-reports");
  revalidatePath(`/field-reports/${payload.reportId}`);
  revalidatePath("/logs/new");
  return { ok: true, reportId: payload.reportId };
}

export async function deleteFieldReportAction(formData: FormData) {
  const reportId = String(formData.get("reportId") ?? "");
  if (!reportId) return;
  const ctx = await requireReporter();
  if (!ctx.ok) return;
  const { supabase, userId } = ctx;

  // 只能刪自己的 pending
  await supabase
    .from("field_reports")
    .delete()
    .eq("id", reportId)
    .eq("author_id", userId)
    .eq("status", "pending");

  revalidatePath("/field-reports");
  revalidatePath("/logs/new");
  redirect("/field-reports");
}
