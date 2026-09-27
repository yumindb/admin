import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { todayLocalDate } from "@/lib/daily-log";
import { loadProfileNames } from "@/lib/logs/proxy";
import { loadStaffDirectory } from "@/lib/staff-directory";
import { AttendanceReportClient, type CaseOpt, type UserOpt, type EventRow } from "./client";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  from?: string;
  to?: string;
  case?: string;
  user?: string;
}>;

const ROLE_LABEL: Record<string, string> = {
  office_staff: "辦公室助理",
  site_supervisor: "工地主任",
  owner: "老闆",
  reviewer: "審閱人",
  field_assistant: "現場人員",
};

// 預設日期區間用台灣日期(伺服器在 UTC,getFullYear/getDate 在台灣 00:00–07:59 會拿到昨天)
function todayLocalIsoDate(): string {
  return todayLocalDate();
}

function firstOfMonthLocalIsoDate(): string {
  return `${todayLocalDate().slice(0, 8)}01`;
}

export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role === "field_assistant") redirect("/");

  const sp = await searchParams;
  const from = sp.from ?? firstOfMonthLocalIsoDate();
  const to = sp.to ?? todayLocalIsoDate();
  const caseId = sp.case ?? "";
  const userId = sp.user ?? "";

  const supabase = await createClient();

  // 同步撈 cases + 人員給 filter dropdown。
  // 人員與下面的打卡人名字走 service role(上面已擋掉現場人員):打卡紀錄全員可讀,
  // 但主任讀不到別人的 profile(RLS)— 以前主任看到的名字全是「—」、人員篩選只有自己。
  const [{ data: caseRows }, staffList] = await Promise.all([
    supabase
      .from("cases")
      .select("id, code, name")
      .order("created_at", { ascending: false })
      .limit(500),
    loadStaffDirectory({
      roles: ["site_supervisor", "field_assistant", "owner", "office_staff"],
      activeOnly: false,
    }),
  ]);

  const cases: CaseOpt[] = (caseRows ?? []).map((c) => ({
    id: c.id as string,
    label: (c.code ? `${c.code}｜` : "") + (c.name as string),
  }));
  const users: UserOpt[] = staffList.map((p) => ({
    id: p.id,
    label: `${p.name}（${ROLE_LABEL[p.role] ?? p.role}）`,
  }));

  // 撈當前 filter 下的事件(server-side render)
  const fromIso = `${from}T00:00:00+08:00`;
  const toIso = `${to}T23:59:59+08:00`;
  let q = supabase
    .from("attendance_events")
    .select(
      "id, user_id, case_id, event_type, lat, lng, accuracy_m, distance_m, within_geofence, source, note, created_at",
    )
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (caseId) q = q.eq("case_id", caseId);
  if (userId) q = q.eq("user_id", userId);
  const { data: events } = await q;

  const userIds = Array.from(new Set((events ?? []).map((e) => e.user_id as string)));
  const caseIds = Array.from(
    new Set(
      (events ?? [])
        .map((e) => e.case_id as string | null)
        .filter((id): id is string => !!id),
    ),
  );
  const [userNameById, { data: casesForEvts }] = await Promise.all([
    loadProfileNames(userIds),
    caseIds.length > 0
      ? supabase.from("cases").select("id, code, name").in("id", caseIds)
      : Promise.resolve({ data: [] }),
  ]);
  const caseLabelById = new Map<string, string>();
  for (const c of casesForEvts ?? []) {
    const code = c.code as string | null;
    caseLabelById.set(c.id as string, code ? `${code}｜${c.name as string}` : (c.name as string));
  }

  const rows: EventRow[] = (events ?? []).map((e) => ({
    id: e.id as string,
    event_type: e.event_type as "clock_in" | "clock_out",
    user_name: userNameById.get(e.user_id as string) ?? "—",
    case_label: e.case_id
      ? caseLabelById.get(e.case_id as string) ?? "（未知案件）"
      : null,
    lat: e.lat as number | null,
    lng: e.lng as number | null,
    accuracy_m: e.accuracy_m as number | null,
    distance_m: e.distance_m as number | null,
    within_geofence: e.within_geofence as boolean | null,
    source: e.source as string | null,
    note: e.note as string | null,
    created_at: e.created_at as string,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/reports" className="hover:text-accent">報表</Link>
        <span className="mx-1.5">／</span>
        <span>現場出勤</span>
      </nav>
      <h1 className="mb-2 text-2xl font-semibold text-primary md:text-3xl">現場出勤</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        工地主任、現場人員的 GPS 打卡紀錄。距離工地超出 geofence 範圍的事件會標註。
      </p>

      <AttendanceReportClient
        cases={cases}
        users={users}
        initialFrom={from}
        initialTo={to}
        initialCaseId={caseId}
        initialUserId={userId}
        rows={rows}
        canBackfill={actor.role === "office_staff" || actor.role === "owner"}
      />
    </div>
  );
}
