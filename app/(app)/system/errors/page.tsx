import { requireSystemAdmin } from "@/lib/monitor/access";
import {
  MonitorNotReadyError,
  loadErrorDaily,
  loadErrorGroups,
  loadPeople,
  loadRecentErrors,
  sinceIso,
  type ErrorGroup,
  type ErrorRow,
} from "@/lib/monitor/queries";
import { actionLabel, routeLabel } from "@/lib/monitor/labels";
import { deviceLabel } from "@/lib/monitor/shared";
import { formatTW } from "@/lib/datetime";
import { DailyBars } from "../daily-bars";
import {
  DayPills,
  EmptyNote,
  MonitorHeader,
  NotReadyNotice,
  Pill,
  Section,
  StatTile,
  fillDays,
  formatCount,
  hrefWith,
  parseDays,
  personText,
  roleText,
} from "../monitor-ui";

export const dynamic = "force-dynamic";

/**
 * /system/errors — 錯誤紀錄:伺服器、資料庫、使用者瀏覽器上發生的錯誤,同類的歸成一組。
 * 資料:error_logs(migration-2.39)。
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SUBTITLE = "使用者碰到的錯誤會自動記在這裡，同一種錯誤歸成一組 — 不用等人回報就能先處理";

const SOURCE_LABEL: Record<ErrorGroup["source"], string> = {
  server: "伺服器",
  db: "資料庫",
  client: "使用者瀏覽器",
};

const ROUTE_TYPE_LABEL: Record<string, string> = {
  render: "開頁面時",
  action: "按鈕操作時",
  route: "API",
  proxy: "登入檢查時",
  boundary: "畫面顯示時",
  global: "整頁當掉",
  window: "瀏覽器執行時",
  promise: "瀏覽器背景工作",
};

const SOURCES = ["server", "db", "client"] as const;

const when = (iso: string) =>
  iso ? formatTW(iso, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export default async function ErrorsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSystemAdmin();
  const sp = await searchParams;
  const days = parseDays(sp);
  const source = (SOURCES as readonly string[]).includes(String(sp.source)) ? String(sp.source) : null;
  const includeWarn = sp.level === "all";

  let loaded;
  try {
    loaded = await Promise.all([loadErrorGroups(days), loadRecentErrors(days), loadErrorDaily(days), loadPeople()]);
  } catch (e) {
    if (e instanceof MonitorNotReadyError) {
      return (
        <div className="mx-auto max-w-6xl">
          <MonitorHeader active="errors" subtitle={SUBTITLE} />
          <NotReadyNotice />
        </div>
      );
    }
    throw e;
  }
  const [allGroups, recent, daily, people] = loaded;

  const since = new Date(sinceIso(days)).getTime();
  const groups = allGroups
    .filter((g) => (includeWarn || g.level === "error") && (!source || g.source === source))
    .sort((a, b) => b.last_at.localeCompare(a.last_at));
  const shown = new Set(groups.map((g) => g.fingerprint));
  const byFingerprint = new Map<string, ErrorRow[]>();
  for (const row of recent) {
    if (!shown.has(row.fingerprint)) continue;
    const list = byFingerprint.get(row.fingerprint) ?? [];
    if (list.length < 5) list.push(row);
    byFingerprint.set(row.fingerprint, list);
  }

  const totalOccurrences = groups.reduce((n, g) => n + g.occurrences, 0);
  const affectedUsers = new Set(recent.filter((r) => shown.has(r.fingerprint) && r.user_id).map((r) => r.user_id)).size;
  const newGroups = groups.filter((g) => new Date(g.first_ever_at).getTime() >= since).length;
  const hiddenWarns = includeWarn ? 0 : allGroups.filter((g) => g.level === "warn").length;

  const chart = fillDays(daily, days, (row, day) => ({
    day,
    value: row?.errors ?? 0,
    lines: row ? [`另有警告 ${row.warns} 次`, `影響 ${row.users} 人`] : ["沒有錯誤"],
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <MonitorHeader active="errors" subtitle={SUBTITLE} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <DayPills basePath="/system/errors" sp={sp} days={days} />
        <span className="mx-1 h-5 w-px bg-[#E0DCD6]" />
        <Pill href={hrefWith("/system/errors", sp, { source: null })} active={!source}>
          全部來源
        </Pill>
        {SOURCES.map((s) => (
          <Pill key={s} href={hrefWith("/system/errors", sp, { source: s })} active={source === s}>
            {SOURCE_LABEL[s]}
          </Pill>
        ))}
        <span className="mx-1 h-5 w-px bg-[#E0DCD6]" />
        <Pill href={hrefWith("/system/errors", sp, { level: includeWarn ? null : "all" })} active={includeWarn}>
          含警告
        </Pill>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="發生次數" value={formatCount(totalOccurrences)} />
        <StatTile label="錯誤種類" value={formatCount(groups.length)} />
        <StatTile label="影響人數" value={formatCount(affectedUsers)} />
        <StatTile label="這段期間新出現" value={formatCount(newGroups)} hint="以前沒看過的錯誤" />
      </div>

      <Section title="每日錯誤數" description="只算「錯誤」，不含警告（登入過期、權限不足這類預期中的狀況）">
        <div className="rounded-md border border-[#E0DCD6] bg-card p-4">
          <DailyBars data={chart} unit="次錯誤" ariaLabel="每日錯誤數" />
        </div>
      </Section>

      <Section
        title="錯誤清單"
        description={
          hiddenWarns > 0
            ? `最近發生的排最上面。另有 ${hiddenWarns} 種警告沒顯示，點「含警告」可以看`
            : "最近發生的排最上面，點開看每一次的細節"
        }
      >
        {groups.length === 0 ? (
          <EmptyNote>這段期間沒有符合條件的錯誤 — 很好。</EmptyNote>
        ) : (
          <ul className="space-y-3">
            {groups.map((g) => {
              const isNew = new Date(g.first_ever_at).getTime() >= since;
              const rows = byFingerprint.get(g.fingerprint) ?? [];
              return (
                <li key={g.fingerprint} className="rounded-md border border-[#E0DCD6] bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-[#E0DCD6] px-2 py-0.5 text-muted-foreground">
                      {SOURCE_LABEL[g.source] ?? g.source}
                    </span>
                    {g.level === "warn" ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">警告</span>
                    ) : (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">錯誤</span>
                    )}
                    {isNew && <span className="rounded-full bg-primary px-2 py-0.5 text-primary-foreground">新</span>}
                  </div>
                  <p className="mt-2 break-words font-semibold text-foreground">{g.message}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    發生 {formatCount(g.occurrences)} 次・{g.users} 人・最近 {when(g.last_at)}・首次 {when(g.first_ever_at)}
                    {g.route && <>・{routeLabel(g.route)}</>}
                  </p>
                  {rows.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-primary">最近 {rows.length} 次的細節</summary>
                      <ul className="mt-2 space-y-3">
                        {rows.map((r) => {
                          const person = r.user_id ? people.get(r.user_id) : undefined;
                          return (
                            <li key={r.id} className="rounded-md bg-[#F5F1EC] p-3 text-sm">
                              <p className="text-[#5A5050]">
                                <span className="tabular-nums">
                                  {formatTW(r.occurred_at, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                </span>
                                ・{personText(person, r.user_id)}
                                <span className="text-muted-foreground">（{roleText(r.role ?? person?.role)}）</span>
                                {r.route_type && <>・{ROUTE_TYPE_LABEL[r.route_type] ?? r.route_type}</>}
                                {r.action_name && <>・{actionLabel(r.action_name)}</>}
                                {r.user_agent && <>・{deviceLabel(r.user_agent)}</>}
                              </p>
                              {r.path && <p className="mt-1 font-mono text-xs text-muted-foreground">{r.path}</p>}
                              {r.digest && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  畫面上的錯誤代碼：<span className="font-mono">{r.digest}</span>
                                </p>
                              )}
                              {r.detail && (
                                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-[#E0DCD6] bg-white p-2 text-xs text-[#5A5050]">
                                  {r.detail}
                                </pre>
                              )}
                              {r.stack && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-xs text-muted-foreground">技術細節（stack）</summary>
                                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre rounded border border-[#E0DCD6] bg-white p-2 text-[11px] leading-relaxed text-[#5A5050]">
                                    {r.stack}
                                  </pre>
                                </details>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
