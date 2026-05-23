import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { AttendanceClient, type CaseOption, type AttendanceItem } from "./attendance-client";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");

  const supabase = await createClient();

  // 撈 active + paused 案件給打卡選擇(closed 案件不該再打卡)
  const { data: caseRows } = await supabase
    .from("cases")
    .select("id, code, name, location, lat, lng, geofence_radius_m, status")
    .in("status", ["active", "paused"])
    .order("status", { ascending: true })  // active 先
    .order("created_at", { ascending: false })
    .limit(200);

  const cases: CaseOption[] = (caseRows ?? []).map((c) => ({
    id: c.id as string,
    code: (c.code as string | null) ?? null,
    name: c.name as string,
    location: (c.location as string | null) ?? null,
    lat: c.lat as number | null,
    lng: c.lng as number | null,
    geofence_radius_m: (c.geofence_radius_m as number | null) ?? 200,
    status: c.status as "active" | "paused",
  }));

  // 撈本人今日打卡紀錄(以 Asia/Taipei 日界)
  const today = new Date();
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  const { data: eventRows } = await supabase
    .from("attendance_events")
    .select("id, case_id, event_type, lat, lng, accuracy_m, distance_m, within_geofence, note, created_at")
    .eq("user_id", actor.id)
    .gte("created_at", startOfToday.toISOString())
    .order("created_at", { ascending: false });

  const caseNameById = new Map<string, string>();
  for (const c of cases) caseNameById.set(c.id, c.code ? `${c.code}｜${c.name}` : c.name);

  const todayEvents: AttendanceItem[] = (eventRows ?? []).map((r) => ({
    id: r.id as string,
    case_id: r.case_id as string | null,
    case_label: r.case_id ? caseNameById.get(r.case_id as string) ?? null : null,
    event_type: r.event_type as "clock_in" | "clock_out",
    lat: r.lat as number,
    lng: r.lng as number,
    accuracy_m: r.accuracy_m as number | null,
    distance_m: r.distance_m as number | null,
    within_geofence: r.within_geofence as boolean | null,
    note: r.note as string | null,
    created_at: r.created_at as string,
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-accent">首頁</Link>
        <span className="mx-1.5">／</span>
        <span>打卡</span>
        <span className="mx-1.5">·</span>
        <Link href="/my-cases" className="hover:text-accent">
          我的案場
        </Link>
      </nav>
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">
        上下班打卡
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        系統會記錄你的位置與離工地距離。允許瀏覽器使用定位後,會自動推薦最近案件。
      </p>

      <AttendanceClient
        cases={cases}
        initialToday={todayEvents}
        role={actor.role}
      />
    </div>
  );
}
