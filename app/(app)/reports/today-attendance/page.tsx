import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryGetActor } from "@/lib/auth/require-role";
import { formatDistance } from "@/lib/geo";

export const dynamic = "force-dynamic";

/**
 * 今日打卡儀表板 — 老闆視角的核心需求。
 *
 * 痛點(老闆視角測試):
 *   /reports/attendance 給的是逐筆 1000 條 event row,
 *   不是「今日每個主任的紅綠燈」。要看 X 主任今天有沒有打卡得自己用人員 filter 撈。
 *
 * 設計:
 *   - 每個 active 主任 + 現場人員一個 row
 *   - 紅綠燈規則:
 *     ✓ 綠 — 已打卡 + 上下班都有 + 在工地範圍內
 *     ⚠ 黃 — 已打卡 + 上下班只有其中一筆 / 範圍外 / 跨案件
 *     ✗ 紅 — 今天沒打卡
 *   - 顯示最近一筆事件的時間 + 案件 + 距離
 *
 * 預設按紅 > 黃 > 綠排序(老闆早上看「誰沒打卡」優先)。
 */

type Light = "red" | "amber" | "green";

const ROLE_LABEL: Record<string, string> = {
  site_supervisor: "工地主任",
  field_assistant: "現場人員",
  owner: "老闆",
  office_staff: "辦公室助理",
};

const LIGHT_META: Record<Light, { label: string; cls: string; sort: number }> = {
  red: {
    label: "未打卡",
    cls: "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]",
    sort: 0,
  },
  amber: {
    label: "需注意",
    cls: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
    sort: 1,
  },
  green: {
    label: "正常",
    cls: "border-[#A7F3D0] bg-[#ECFDF5] text-[#15803D]",
    sort: 2,
  },
};

export default async function TodayAttendancePage() {
  const actor = await tryGetActor();
  if (!actor) redirect("/login");
  if (actor.role !== "owner" && actor.role !== "office_staff") {
    redirect("/");
  }

  const supabase = await createClient();

  // 今日起迄(Asia/Taipei,簡化用 +08:00)
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const fromIso = `${y}-${m}-${d}T00:00:00+08:00`;
  const toIso = `${y}-${m}-${d}T23:59:59+08:00`;

  // 撈所有 active 主任 + 現場人員
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, role, company")
    .in("role", ["site_supervisor", "field_assistant"])
    .eq("is_active", true)
    .order("role", { ascending: true })
    .order("full_name", { ascending: true });

  // 撈今日所有打卡事件
  const { data: events } = await supabase
    .from("attendance_events")
    .select(
      "id, user_id, case_id, event_type, distance_m, within_geofence, created_at",
    )
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: true });

  // 撈所有用到的 case 名字
  const caseIds = Array.from(
    new Set(
      (events ?? [])
        .map((e) => e.case_id as string | null)
        .filter((id): id is string => !!id),
    ),
  );
  const { data: cases } = caseIds.length
    ? await supabase.from("cases").select("id, code, name").in("id", caseIds)
    : { data: [] };
  const caseLabelById = new Map<string, string>();
  for (const c of cases ?? []) {
    const code = c.code as string | null;
    const name = c.name as string;
    caseLabelById.set(c.id as string, code ? `${code}｜${name}` : name);
  }

  // per-user 彙整
  type UserRow = {
    id: string;
    name: string;
    role: string;
    company: string | null;
    light: Light;
    summary: string;
    events: Array<{
      type: "clock_in" | "clock_out";
      time: string;
      caseLabel: string | null;
      distance: number | null;
      within: boolean | null;
    }>;
  };

  const eventsByUser = new Map<string, NonNullable<typeof events>>();
  for (const e of events ?? []) {
    const arr = eventsByUser.get(e.user_id as string) ?? [];
    arr.push(e);
    eventsByUser.set(e.user_id as string, arr);
  }

  const rows: UserRow[] = (profiles ?? []).map((p) => {
    const userEvents = eventsByUser.get(p.id as string) ?? [];
    const inEvents = userEvents.filter((e) => e.event_type === "clock_in");
    const outEvents = userEvents.filter((e) => e.event_type === "clock_out");
    const anyOutsideGeofence = userEvents.some(
      (e) => e.within_geofence === false,
    );
    const distinctCases = new Set(
      userEvents.map((e) => e.case_id as string | null).filter(Boolean),
    );

    let light: Light = "red";
    let summary = "今日尚未打卡";
    if (userEvents.length === 0) {
      light = "red";
      summary = "今日尚未打卡";
    } else if (anyOutsideGeofence) {
      light = "amber";
      summary = "有打卡，但部分位置超出工地範圍";
    } else if (inEvents.length === 0) {
      light = "amber";
      summary = "只有下班，沒上班打卡";
    } else if (outEvents.length === 0) {
      light = "amber";
      summary = `已上班打卡（${inEvents.length} 次），尚未下班`;
    } else if (distinctCases.size > 1) {
      light = "amber";
      summary = `跨 ${distinctCases.size} 個工地，請確認`;
    } else {
      light = "green";
      summary = `已完整打卡（上 ${inEvents.length} / 下 ${outEvents.length}）`;
    }

    const timeFmt = new Intl.DateTimeFormat("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Taipei",
    });

    return {
      id: p.id as string,
      name: p.full_name as string,
      role: ROLE_LABEL[p.role as string] ?? (p.role as string),
      company: p.company as string | null,
      light,
      summary,
      events: userEvents.map((e) => ({
        type: e.event_type as "clock_in" | "clock_out",
        time: timeFmt.format(new Date(e.created_at as string)),
        caseLabel: e.case_id
          ? caseLabelById.get(e.case_id as string) ?? "（未知案件）"
          : null,
        distance: e.distance_m as number | null,
        within: e.within_geofence as boolean | null,
      })),
    };
  });

  // 排序:紅 > 黃 > 綠;同 light 內按角色 + 姓名
  rows.sort((a, b) => {
    const sa = LIGHT_META[a.light].sort;
    const sb = LIGHT_META[b.light].sort;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name, "zh-Hant");
  });

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.light]++;
      return acc;
    },
    { red: 0, amber: 0, green: 0 } as Record<Light, number>,
  );

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-3 text-sm text-muted-foreground">
        <Link href="/reports" className="hover:text-accent">
          報表
        </Link>
        <span className="mx-1.5">／</span>
        <span>今日打卡儀表板</span>
      </nav>
      <h1 className="mb-1 text-2xl font-semibold text-primary md:text-3xl">
        今日打卡儀表板
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        每位主任 / 現場人員今天的打卡狀態。紅燈優先排在最上面。
      </p>

      {/* 紅綠燈統計列 */}
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-md border px-3 py-1.5 ${LIGHT_META.red.cls}`}>
          ✗ 未打卡 <span className="ml-1 font-semibold tabular-nums">{counts.red}</span>
        </span>
        <span className={`rounded-md border px-3 py-1.5 ${LIGHT_META.amber.cls}`}>
          ⚠ 需注意 <span className="ml-1 font-semibold tabular-nums">{counts.amber}</span>
        </span>
        <span className={`rounded-md border px-3 py-1.5 ${LIGHT_META.green.cls}`}>
          ✓ 正常 <span className="ml-1 font-semibold tabular-nums">{counts.green}</span>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          共 {rows.length} 人
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#E0DCD6] bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          目前沒有任何 active 主任或現場人員
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-[#E0DCD6] bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-base font-semibold text-primary">
                      {r.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {r.role}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {r.summary}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${LIGHT_META[r.light].cls}`}
                >
                  {LIGHT_META[r.light].label}
                </span>
              </div>

              {r.events.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-[#F0EBE4] pt-2 text-xs text-muted-foreground">
                  {r.events.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono tabular-nums text-foreground">
                        {e.time}
                      </span>
                      <span className="font-medium">
                        {e.type === "clock_in" ? "上班" : "下班"}
                      </span>
                      <span className="break-words">
                        {e.caseLabel ?? "（無案件）"}
                      </span>
                      {e.distance !== null && (
                        <span
                          className={
                            e.within === false
                              ? "rounded bg-[#FEF2F2] px-1.5 text-[#B91C1C]"
                              : ""
                          }
                        >
                          {formatDistance(e.distance)}
                          {e.within === false && " 超出"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 rounded-md border border-[#E0DCD6] bg-card px-4 py-3 text-xs text-muted-foreground">
        💡 看完整逐筆事件清單請到{" "}
        <Link href="/reports/attendance" className="text-accent hover:underline">
          現場出勤
        </Link>
        ，可依日期、案件、人員篩選並匯出 Excel。
      </div>
    </div>
  );
}
