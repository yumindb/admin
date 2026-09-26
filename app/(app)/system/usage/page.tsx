import { requireSystemAdmin } from "@/lib/monitor/access";
import {
  MonitorNotReadyError,
  loadDailyCounts,
  loadLoginCounts,
  loadPeople,
  loadRequestStats,
  loadUserStats,
} from "@/lib/monitor/queries";
import { BACKGROUND_ACTIONS, actionLabel, routeLabel } from "@/lib/monitor/labels";
import { DEFAULT_SLOW_MS } from "@/lib/monitor/shared";
import { formatTW } from "@/lib/datetime";
import { DailyBars } from "../daily-bars";
import {
  DayPills,
  EmptyNote,
  MonitorHeader,
  NotReadyNotice,
  Section,
  StatTile,
  fillDays,
  formatCount,
  formatMs,
  parseDays,
  roleText,
} from "../monitor-ui";

export const dynamic = "force-dynamic";

/**
 * /system/usage — 常用操作:誰在用、用哪些功能、多常用。
 * 資料:request_logs(migration-2.39)+ login_attempts 的成功登入。
 * 只有系統管理者看得到(SYSTEM_ADMIN_USERNAMES)。
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SUBTITLE = "每一次開頁面、按按鈕送出都會記一筆 — 看出哪些功能最常用、誰很久沒上線";

const lastAt = (iso: string) =>
  iso ? formatTW(iso, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export default async function UsagePage({ searchParams }: { searchParams: SearchParams }) {
  await requireSystemAdmin();
  const sp = await searchParams;
  const days = parseDays(sp);

  let loaded;
  try {
    loaded = await Promise.all([
      loadRequestStats(days, DEFAULT_SLOW_MS),
      loadUserStats(days),
      loadDailyCounts(days, DEFAULT_SLOW_MS),
      loadPeople(),
      loadLoginCounts(days),
    ]);
  } catch (e) {
    if (e instanceof MonitorNotReadyError) {
      return (
        <div className="mx-auto max-w-6xl">
          <MonitorHeader active="usage" subtitle={SUBTITLE} />
          <NotReadyNotice />
        </div>
      );
    }
    throw e;
  }
  const [stats, userStats, daily, people, logins] = loaded;

  const views = stats.filter((s) => s.kind === "view").sort((a, b) => b.calls - a.calls);
  const actions = stats.filter((s) => s.kind === "action");
  const mainActions = actions
    .filter((a) => !BACKGROUND_ACTIONS.has(a.action_name ?? ""))
    .sort((a, b) => b.calls - a.calls);
  const backgroundActions = actions
    .filter((a) => BACKGROUND_ACTIONS.has(a.action_name ?? ""))
    .sort((a, b) => b.calls - a.calls);

  const totalViews = views.reduce((n, s) => n + s.calls, 0);
  const totalActions = mainActions.reduce((n, s) => n + s.calls, 0);
  const totalLogins = [...logins.values()].reduce((n, c) => n + c, 0);

  // 每人:所有啟用中的帳號都列出來(沒用的人也要看得到),再加上期間內有紀錄但已停用的
  const statByUser = new Map(userStats.map((u) => [u.user_id, u]));
  const personIds = new Set<string>([
    ...[...people.entries()].filter(([, p]) => p.isActive).map(([id]) => id),
    ...userStats.map((u) => u.user_id),
  ]);
  const personRows = [...personIds]
    .map((id) => {
      const p = people.get(id);
      const s = statByUser.get(id);
      return {
        id,
        name: p?.name ?? "（已刪除的帳號）",
        role: p?.role ?? null,
        username: p?.username ?? null,
        logins: p?.username ? logins.get(p.username.toLowerCase()) ?? 0 : 0,
        views: s?.views ?? 0,
        actions: s?.actions ?? 0,
        lastAt: s?.last_at ?? "",
      };
    })
    .sort(
      (a, b) =>
        b.actions + b.views + b.logins - (a.actions + a.views + a.logins) ||
        a.name.localeCompare(b.name, "zh-Hant"),
    );
  const idleCount = personRows.filter((p) => p.views + p.actions + p.logins === 0).length;

  const chart = fillDays(daily, days, (row, day) => ({
    day,
    value: (row?.views ?? 0) + (row?.actions ?? 0),
    lines: row ? [`頁面 ${formatCount(row.views)}、操作 ${formatCount(row.actions)}`, `${row.users} 人使用`] : ["沒有使用紀錄"],
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <MonitorHeader active="usage" subtitle={SUBTITLE} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <DayPills basePath="/system/usage" sp={sp} days={days} />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="操作次數" value={formatCount(totalActions)} hint="按按鈕送出（不含背景自動動作）" />
        <StatTile label="頁面瀏覽" value={formatCount(totalViews)} />
        <StatTile
          label="使用人數"
          value={formatCount(userStats.length)}
          hint={idleCount > 0 ? `另有 ${idleCount} 個啟用中的帳號沒有使用` : undefined}
        />
        <StatTile label="登入次數" value={formatCount(totalLogins)} />
      </div>

      <Section title="每日使用量" description="頁面瀏覽＋操作次數。滑鼠移到長條上看當天明細">
        <div className="rounded-md border border-[#E0DCD6] bg-card p-4">
          <DailyBars data={chart} unit="次" ariaLabel="每日使用量" />
        </div>
      </Section>

      <Section title="最常用的操作" description="依次數排序。「在哪一頁」是最常從哪一頁按的">
        {mainActions.length === 0 ? (
          <EmptyNote>這段期間還沒有操作紀錄。</EmptyNote>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[#E0DCD6] bg-[#F5F1EC] text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">操作</th>
                  <th className="px-4 py-3 text-right font-medium">次數</th>
                  <th className="px-4 py-3 text-right font-medium">人數</th>
                  <th className="px-4 py-3 text-right font-medium">平均耗時</th>
                  <th className="px-4 py-3 text-right font-medium">出錯</th>
                  <th className="px-4 py-3 font-medium">最近一次</th>
                </tr>
              </thead>
              <tbody>
                {mainActions.map((a) => (
                  <tr key={a.action_name ?? a.route} className="border-b border-[#E0DCD6]/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="text-foreground">{actionLabel(a.action_name)}</div>
                      <div className="text-xs text-muted-foreground">在「{routeLabel(a.route)}」</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(a.calls)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a.users}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMs(a.avg_ms)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${a.errors > 0 ? "font-semibold text-red-700" : "text-muted-foreground"}`}>
                      {a.errors > 0 ? a.errors : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">{lastAt(a.last_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {backgroundActions.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              背景自動動作（{backgroundActions.reduce((n, a) => n + a.calls, 0)} 次，不列入排行）
            </summary>
            <ul className="mt-2 space-y-1 pl-5 text-muted-foreground">
              {backgroundActions.map((a) => (
                <li key={a.action_name ?? a.route} className="list-disc">
                  {actionLabel(a.action_name)} — {formatCount(a.calls)} 次，平均 {formatMs(a.avg_ms)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="最常看的頁面">
        {views.length === 0 ? (
          <EmptyNote>這段期間還沒有頁面瀏覽紀錄。</EmptyNote>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[#E0DCD6] bg-[#F5F1EC] text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">頁面</th>
                  <th className="px-4 py-3 text-right font-medium">次數</th>
                  <th className="px-4 py-3 text-right font-medium">人數</th>
                  <th className="px-4 py-3 text-right font-medium">平均耗時</th>
                  <th className="px-4 py-3 font-medium">最近一次</th>
                </tr>
              </thead>
              <tbody>
                {views.map((v) => (
                  <tr key={v.route} className="border-b border-[#E0DCD6]/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="text-foreground">{routeLabel(v.route)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{v.route}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(v.calls)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{v.users}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMs(v.avg_ms)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">{lastAt(v.last_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="每個人的使用情況" description="所有啟用中的帳號都列出來；灰色的是這段期間完全沒登入也沒使用">
        <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[#E0DCD6] bg-[#F5F1EC] text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">姓名</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 text-right font-medium">登入</th>
                <th className="px-4 py-3 text-right font-medium">頁面</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
                <th className="px-4 py-3 font-medium">最後活動</th>
              </tr>
            </thead>
            <tbody>
              {personRows.map((p) => {
                const idle = p.views + p.actions + p.logins === 0;
                return (
                  <tr key={p.id} className={`border-b border-[#E0DCD6]/60 last:border-0 ${idle ? "text-muted-foreground" : ""}`}>
                    <td className="px-4 py-2.5">
                      {p.name}
                      {p.username && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.username}</span>}
                    </td>
                    <td className="px-4 py-2.5">{roleText(p.role)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.logins || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.views || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.actions || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {idle
                        ? "這段期間沒有使用"
                        : p.lastAt
                          ? lastAt(p.lastAt)
                          : // 只有登入紀錄:頁面 / 操作紀錄是 2026-09-26 系統監控上線後才開始記
                            "有登入，沒有頁面紀錄"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <details className="mb-8 text-sm text-muted-foreground">
        <summary className="cursor-pointer">每日數字（表格）</summary>
        <table className="mt-2 w-full max-w-md text-left tabular-nums">
          <thead>
            <tr>
              <th className="py-1 font-medium">日期</th>
              <th className="py-1 text-right font-medium">頁面</th>
              <th className="py-1 text-right font-medium">操作</th>
              <th className="py-1 text-right font-medium">人數</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.day}>
                <td className="py-0.5">{d.day}</td>
                <td className="py-0.5 text-right">{d.views}</td>
                <td className="py-0.5 text-right">{d.actions}</td>
                <td className="py-0.5 text-right">{d.users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
