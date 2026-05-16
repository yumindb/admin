import { formatDistance, googleMapsLink } from "@/lib/geo";

const DATE_FMT = new Intl.DateTimeFormat("zh-TW", {
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  timeZone: "Asia/Taipei",
});
const TIME_FMT = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
});

export type TimelineEvent = {
  id: string;
  event_type: "clock_in" | "clock_out";
  user_name: string | null;
  case_label: string | null;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  distance_m: number | null;
  within_geofence: boolean | null;
  note: string | null;
  created_at: string;
};

/**
 * 打卡時間軸 — 案件詳情 / 報表頁共用。
 * 依日期分組,每日內依時間倒序。distance / within_geofence 用顏色標註。
 */
export function AttendanceTimeline({
  events,
  showUser = true,
  showCase = false,
  emptyText = "目前沒有打卡紀錄",
}: {
  events: TimelineEvent[];
  showUser?: boolean;
  showCase?: boolean;
  emptyText?: string;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[#E0DCD6] bg-[#FBF8F4] px-4 py-6 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  // 依日期分組(以 Asia/Taipei 日界)
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const d = new Date(e.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const ordered = Array.from(groups.entries()).map(([key, evts]) => ({
    key,
    label: DATE_FMT.format(new Date(evts[0].created_at)),
    events: evts,
  }));

  return (
    <div className="space-y-4">
      {ordered.map((group) => (
        <div key={group.key}>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            {group.label}
          </div>
          <ul className="divide-y divide-[#F2EFEB] rounded-md border border-[#E0DCD6] bg-card">
            {group.events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                <span className="mt-0.5 inline-block w-12 shrink-0 rounded-md bg-[#F5F1EC] py-0.5 text-center font-mono text-xs tabular-nums text-foreground">
                  {TIME_FMT.format(new Date(e.created_at))}
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${
                    e.event_type === "clock_in"
                      ? "bg-primary text-primary-foreground"
                      : "border border-primary text-primary"
                  }`}
                >
                  {e.event_type === "clock_in" ? "上班" : "下班"}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  {showUser && e.user_name && (
                    <div className="truncate text-foreground">{e.user_name}</div>
                  )}
                  {showCase && e.case_label && (
                    <div className="truncate text-xs text-muted-foreground">
                      {e.case_label}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {e.distance_m !== null ? (
                      <span>
                        {formatDistance(e.distance_m)}
                        {e.within_geofence === false && (
                          <span className="ml-1 rounded bg-[#FFFBEB] px-1.5 py-0.5 text-[#A07850]">
                            超出範圍
                          </span>
                        )}
                      </span>
                    ) : (
                      <span>未設座標</span>
                    )}
                    {e.accuracy_m !== null && (
                      <span>· 精度 ±{Math.round(e.accuracy_m)} m</span>
                    )}
                    <a
                      href={googleMapsLink({ lat: e.lat, lng: e.lng })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-accent underline-offset-2 hover:underline"
                    >
                      地圖 ↗
                    </a>
                  </div>
                  {e.note && (
                    <div className="mt-0.5 text-xs text-foreground/80">{e.note}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
