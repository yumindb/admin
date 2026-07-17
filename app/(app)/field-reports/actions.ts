"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { evaluateGeofence } from "@/lib/geo";
import type { FieldReportPhoto, UserRole } from "@/lib/types";

/** 隱式 GPS 戳記(migration-2.22) */
export type SubmitLocationInput = {
  lat: number;
  lng: number;
  accuracy_m: number | null;
};

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
  submitLocation?: SubmitLocationInput | null;  // 隱式 GPS 戳記
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

  // 隱式 GPS 戳記 — 算距離 + within
  const insertPayload: Record<string, unknown> = {
    case_id: payload.caseId,
    author_id: userId,
    note: trimmedNote || null,
    photos: payload.photos,
  };
  if (payload.submitLocation) {
    const loc = payload.submitLocation;
    const { data: caseRow } = await supabase
      .from("cases")
      .select("lat, lng, geofence_radius_m")
      .eq("id", payload.caseId)
      .maybeSingle();
    const evald = evaluateGeofence(
      {
        lat: (caseRow?.lat as number | null) ?? null,
        lng: (caseRow?.lng as number | null) ?? null,
        geofence_radius_m: (caseRow?.geofence_radius_m as number) ?? 200,
      },
      { lat: loc.lat, lng: loc.lng },
    );
    insertPayload.submit_lat = loc.lat;
    insertPayload.submit_lng = loc.lng;
    insertPayload.submit_accuracy_m = loc.accuracy_m;
    insertPayload.submit_distance_m = evald.distanceM;
    insertPayload.submit_within_geofence = evald.withinGeofence;
  }

  const { data, error } = await supabase
    .from("field_reports")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "儲存失敗：" + (error?.message ?? "unknown") };
  }

  // LINE 通知辦公室助理有新回報(不阻塞、失敗不影響回報)
  const newReportId = data.id as string;
  after(async () => {
    const { notifyFieldReportCreated } = await import(
      "@/lib/notifications/events"
    );
    await notifyFieldReportCreated(newReportId);
  });

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
    return { ok: false, error: "已合併或封存的回報無法修改" };
  }

  const { error } = await supabase
    .from("field_reports")
    .update({
      case_id: payload.caseId,
      note: trimmedNote || null,
      photos: payload.photos,
    })
    .eq("id", payload.reportId);
  if (error) return { ok: false, error: "更新失敗：" + error.message };

  revalidatePath("/field-reports");
  revalidatePath(`/field-reports/${payload.reportId}`);
  revalidatePath("/logs/new");
  return { ok: true, reportId: payload.reportId };
}

/**
 * 刪除回報 — 兩條路徑:
 *   1. 作者本人,status='pending':寫錯了想砍掉
 *   2. 辦公室助理 / 老闆:處理過(下載照片或併入日誌)後想清掉,任何狀態都能刪
 *
 * 已 merged 進日誌的回報請改用「封存」(archiveFieldReportAction),
 * 因為 daily_logs 還靠這筆 record 顯示「來自哪份回報」的審計連結。
 */
export async function deleteFieldReportAction(formData: FormData) {
  const reportId = String(formData.get("reportId") ?? "");
  if (!reportId) return;
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
  const role = profile?.role as UserRole | undefined;

  const { data: existing } = await supabase
    .from("field_reports")
    .select("author_id, status")
    .eq("id", reportId)
    .maybeSingle();
  if (!existing) return;

  const isOfficeOrOwner = role === "office_staff" || role === "owner";
  const isAuthorPending =
    existing.author_id === user.id && existing.status === "pending";
  if (!isOfficeOrOwner && !isAuthorPending) return;

  // merged 的不允許實刪 — 改用封存。讓辦公室助理改按「封存」按鈕。
  if (existing.status === "merged") return;

  await supabase.from("field_reports").delete().eq("id", reportId);

  revalidatePath("/field-reports");
  revalidatePath("/logs/new");
  redirect("/field-reports");
}

/**
 * 封存回報(辦公室助理 / 老闆專用)— 標 archived 不刪。
 * 用在已合併進日誌、或想暫存當審計紀錄但不再進整合流程的情境。
 */
export async function archiveFieldReportAction(formData: FormData) {
  const reportId = String(formData.get("reportId") ?? "");
  if (!reportId) return { ok: false, error: "缺少回報編號" };

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
  const role = profile?.role as UserRole | undefined;
  if (role !== "office_staff" && role !== "owner") {
    return { ok: false, error: "只有辦公室助理或老闆可以封存回報" };
  }

  const { error } = await supabase
    .from("field_reports")
    .update({ status: "archived" })
    .eq("id", reportId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/field-reports");
  revalidatePath(`/field-reports/${reportId}`);
  return { ok: true };
}
