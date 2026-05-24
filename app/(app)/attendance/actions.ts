"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { evaluateGeofence } from "@/lib/geo";

const ClockSchema = z.object({
  event_type: z.enum(["clock_in", "clock_out"]),
  case_id: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy_m: z.coerce.number().nullable().or(z.literal("").transform(() => null)),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export type ClockResult =
  | { ok: true; eventId: string; within_geofence: boolean | null; distance_m: number | null }
  | { ok: false; error: string };

/**
 * 寫一筆打卡事件。允許 site_supervisor / field_assistant / office_staff / owner 都打,
 * 但前端只給前兩者(office/owner 想自己打也不擋,留彈性)。
 *
 * 軟警告政策:within_geofence = false 仍接受寫入,只是 UI 標註。
 * case_id 為 null 時 note 必填(在公司 / 跨工地移動需要說明)。
 */
export async function clockAction(formData: FormData): Promise<ClockResult> {
  // 任何 active 帳號都能打卡(field_assistant 是預設 role)
  const actor = await requireRole([
    "site_supervisor",
    "field_assistant",
    "office_staff",
    "owner",
  ]);

  const raw = {
    event_type: formData.get("event_type") ?? "",
    case_id: (formData.get("case_id") as string | null) ?? null,
    lat: formData.get("lat") ?? "",
    lng: formData.get("lng") ?? "",
    accuracy_m: formData.get("accuracy_m") ?? "",
    note: (formData.get("note") as string | null) ?? "",
  };
  const parsed = ClockSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "資料格式錯誤：" + parsed.error.issues.map((i) => i.message).join(", "),
    };
  }
  const data = parsed.data;

  // 沒選 case 時 note 必填(在公司 / 跨工地移動需要說明)
  if (!data.case_id && !(data.note && data.note.trim())) {
    return { ok: false, error: "未選擇案件時請說明地點/原因（例：在辦公室 / 移動中）" };
  }

  const supabase = await createClient();

  // 撈案件座標 + 半徑,算距離 + 是否在 geofence
  let distance_m: number | null = null;
  let within_geofence: boolean | null = null;
  if (data.case_id) {
    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("lat, lng, geofence_radius_m")
      .eq("id", data.case_id)
      .maybeSingle();
    if (caseErr) {
      return { ok: false, error: "讀取案件失敗：" + caseErr.message };
    }
    if (!caseRow) {
      return { ok: false, error: "找不到此案件" };
    }
    const evald = evaluateGeofence(
      {
        lat: caseRow.lat as number | null,
        lng: caseRow.lng as number | null,
        geofence_radius_m: (caseRow.geofence_radius_m as number) ?? 200,
      },
      { lat: data.lat, lng: data.lng },
    );
    distance_m = evald.distanceM;
    within_geofence = evald.withinGeofence;
  }

  const h = await headers();
  const userAgent = h.get("user-agent");

  const { data: row, error } = await supabase
    .from("attendance_events")
    .insert({
      user_id: actor.id,
      case_id: data.case_id,
      event_type: data.event_type,
      lat: data.lat,
      lng: data.lng,
      accuracy_m: data.accuracy_m,
      distance_m,
      within_geofence,
      source: "web",
      user_agent: userAgent ?? null,
      note: data.note ? data.note.trim() : null,
    })
    .select("id")
    .single();

  if (error || !row) {
    return { ok: false, error: "打卡寫入失敗：" + (error?.message ?? "未知錯誤") };
  }

  revalidatePath("/attendance");
  return {
    ok: true,
    eventId: row.id as string,
    within_geofence,
    distance_m,
  };
}
