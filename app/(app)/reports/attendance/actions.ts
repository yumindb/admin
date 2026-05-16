"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import {
  buildAttendanceReportXlsx,
  type AttendanceReportRow,
} from "@/lib/excel/attendance-report";

const ROLE_LABEL: Record<string, string> = {
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  owner: "老闆",
  field_assistant: "現場助理",
};

export type AttendanceFilters = {
  from: string;       // YYYY-MM-DD
  to: string;         // YYYY-MM-DD (inclusive)
  caseId?: string | null;
  userId?: string | null;
};

/**
 * 撈打卡事件 + xlsx 匯出。office_staff / owner 可下載(管報表)。
 * 工地主任 / 現場助理目前不開下載(可看自己的時間軸,但不抓全員資料)。
 */
export async function exportAttendanceXlsx(
  filters: AttendanceFilters,
): Promise<
  | { ok: true; base64: string; filename: string }
  | { ok: false; error: string }
> {
  await requireRole(["office_staff", "owner"]);
  const supabase = await createClient();

  // 把 from/to 轉成 ISO 區間(Asia/Taipei 日界,簡化用 +08:00)
  const fromIso = `${filters.from}T00:00:00+08:00`;
  const toIso = `${filters.to}T23:59:59+08:00`;

  let q = supabase
    .from("attendance_events")
    .select(
      "id, user_id, case_id, event_type, lat, lng, accuracy_m, distance_m, within_geofence, note, created_at",
    )
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(5000); // 硬上限防爆,3 個月一般人 ~ 200 筆,公司全體一個月也不會破 5000

  if (filters.caseId) q = q.eq("case_id", filters.caseId);
  if (filters.userId) q = q.eq("user_id", filters.userId);

  const { data: events, error } = await q;
  if (error) return { ok: false, error: "讀取失敗:" + error.message };

  // join user + case 名字
  const userIds = Array.from(new Set((events ?? []).map((e) => e.user_id as string)));
  const caseIds = Array.from(
    new Set(
      (events ?? [])
        .map((e) => e.case_id as string | null)
        .filter((id): id is string => !!id),
    ),
  );

  const [{ data: profiles }, { data: cases }] = await Promise.all([
    userIds.length > 0
      ? supabase.from("profiles").select("id, full_name, role").in("id", userIds)
      : Promise.resolve({ data: [] }),
    caseIds.length > 0
      ? supabase.from("cases").select("id, code, name").in("id", caseIds)
      : Promise.resolve({ data: [] }),
  ]);

  const userById = new Map<string, { name: string; role: string }>();
  for (const p of profiles ?? []) {
    userById.set(p.id as string, {
      name: (p.full_name as string) ?? "未命名",
      role: ROLE_LABEL[p.role as string] ?? (p.role as string),
    });
  }
  const caseById = new Map<string, string>();
  for (const c of cases ?? []) {
    const code = c.code as string | null;
    const name = c.name as string;
    caseById.set(c.id as string, code ? `${code}｜${name}` : name);
  }

  const rows: AttendanceReportRow[] = (events ?? []).map((e) => {
    const u = userById.get(e.user_id as string);
    const cid = e.case_id as string | null;
    return {
      created_at: e.created_at as string,
      user_name: u?.name ?? "—",
      user_role: u?.role ?? "—",
      case_label: cid ? caseById.get(cid) ?? "(未知案件)" : "(無案件 / 移動中)",
      event_type: e.event_type as "clock_in" | "clock_out",
      lat: e.lat as number,
      lng: e.lng as number,
      accuracy_m: e.accuracy_m as number | null,
      distance_m: e.distance_m as number | null,
      within_geofence: e.within_geofence as boolean | null,
      note: e.note as string | null,
    };
  });

  const buf = buildAttendanceReportXlsx({
    rangeLabel: `${filters.from} ~ ${filters.to}`,
    rows,
  });
  const base64 = buf.toString("base64");
  const filename = `出勤_${filters.from}_${filters.to}.xlsx`;
  return { ok: true, base64, filename };
}
