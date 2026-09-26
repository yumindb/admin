import { requireSystemAdmin } from "@/lib/monitor/access";
import {
  MonitorNotReadyError,
  loadDailyCounts,
  loadOverallStats,
  loadPeople,
  loadRequestStats,
  loadSlowRequests,
} from "@/lib/monitor/queries";
import { actionLabel, routeLabel } from "@/lib/monitor/labels";
import { DEFAULT_SLOW_MS, SLOW_THRESHOLD_OPTIONS } from "@/lib/monitor/shared";
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
  formatMs,
  hrefWith,
  parseDays,
  personText,
  roleText,
} from "../monitor-ui";

export const dynamic = "force-dynamic";

/**
 * /system/slow — 慢請求:哪些頁面 / 操作讓人等最久。
 * 耗時 = proxy 收到請求 → 伺服器把回應送完(含資料庫查詢與畫面產生),
 * 不含使用者手機的網路與畫面繪製時間。
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SUBTITLE = "伺服器處理每個頁面 / 操作花了多久 — 從收到請求到回應送完，不含使用者那端的網路";

const KIND_LABEL: Record<string, string> = { page: "開頁面", nav: "站內換頁", action: "按鈕操作" };

export default async function SlowPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSystemAdmin();
  const sp = await searchParams;
  const days = parseDays(sp);
  const slowMs = (SLOW_THRESHOLD_OPTIONS as readonly number[]).includes(Number(sp.ms))
    ? Number(sp.ms)
    : DEFAULT_SLOW_MS;

  let loaded;
  try {
    loaded = await Promise.all([
      loadOverallStats(days, slowMs),
      loadRequestStats(days, slowMs),
      loadSlowRequests(days, slowMs),
      loadDailyCounts(days, slowMs),
      loadPeople(),
    ]);
  } catch (e) {
    if (e instanceof MonitorNotReadyError) {
      return (
        <div className="mx-auto max-w-6xl">
          <MonitorHeader active="slow" subtitle={SUBTITLE} />
          <NotReadyNotice />
        </div>
      );
    }
    throw e;
  }
  const [overall, stats, slowRows, daily, people] = loaded;

  // 依 p95 排:「大部分時候都慢」比「偶爾慢一次」更值得先處理
  const ranked = [...stats]
    .filter((s) => s.calls > 0)
    .sort((a, b) => b.p95_ms - a.p95_ms || b.max_ms - a.max_ms)
    .slice(0, 30);
  const slowShare = overall.calls > 0 ? (overall.slow / overall.calls) * 100 : 0;

  const chart = fillDays(daily, days, (row, day) => ({
    day,
    value: row?.slow ?? 0,
    lines: row ? [`全部 ${formatCount(row.views + row.actions)} 次請求`] : ["沒有使用紀錄"],
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <MonitorHeader active="slow" subtitle={SUBTITLE} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <DayPills basePath="/system/slow" sp={sp} days={days} />
        <span className="mx-1 h-5 w-px bg-[#E0DCD6]" />
        <span className="text-sm text-muted-foreground">超過</span>
        {SLOW_THRESHOLD_OPTIONS.map((ms) => (
          <Pill key={ms} href={hrefWith("/system/slow", sp, { ms: String(ms) })} active={slowMs === ms}>
            {ms / 1000} 秒
          </Pill>
        ))}
        <span className="text-sm text-muted-foreground">算慢</span>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="慢請求"
          value={formatCount(overall.slow)}
          hint={overall.calls > 0 ? `佔全部 ${slowShare.toFixed(slowShare < 1 ? 1 : 0)}%（共 ${formatCount(overall.calls)} 次）` : undefined}
        />
        <StatTile label="一般速度（中位數）" value={formatMs(overall.p50_ms)} hint="一半的請求比這個快" />
        <StatTile label="95% 的請求在這之內" value={formatMs(overall.p95_ms)} />
        <StatTile
          label="最慢的一次"
          value={formatMs(overall.max_ms)}
          hint={overall.cold > 0 ? `期間有 ${formatCount(overall.cold)} 次冷啟動` : undefined}
        />
      </div>

      <Section title="每日慢請求數">
        <div className="rounded-md border border-[#E0DCD6] bg-card p-4">
          <DailyBars data={chart} unit="次慢請求" ariaLabel="每日慢請求數" />
        </div>
      </Section>

      <Section
        title="哪些頁面／操作最慢"
        description="依「95% 的請求在多少時間內完成」排序 — 大部分時候都慢的排前面，偶爾慢一次的排後面"
      >
        {ranked.length === 0 ? (
          <EmptyNote>這段期間還沒有請求紀錄。</EmptyNote>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[#E0DCD6] bg-[#F5F1EC] text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">頁面／操作</th>
                  <th className="px-4 py-3 text-right font-medium">次數</th>
                  <th className="px-4 py-3 text-right font-medium">一般</th>
                  <th className="px-4 py-3 text-right font-medium">95% 內</th>
                  <th className="px-4 py-3 text-right font-medium">最慢</th>
                  <th className="px-4 py-3 text-right font-medium">慢請求</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((s) => {
                  const isAction = s.kind === "action";
                  return (
                    <tr key={`${s.kind}|${s.route}|${s.action_name ?? ""}`} className="border-b border-[#E0DCD6]/60 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="text-foreground">{isAction ? actionLabel(s.action_name) : routeLabel(s.route)}</div>
                        <div className="text-xs text-muted-foreground">
                          {isAction ? `按鈕操作・在「${routeLabel(s.route)}」` : `頁面・${s.route}`}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(s.calls)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatMs(s.p50_ms)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${s.p95_ms >= slowMs ? "font-semibold text-foreground" : ""}`}>
                        {formatMs(s.p95_ms)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatMs(s.max_ms)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {s.slow > 0 ? (
                          <span>
                            {s.slow}
                            {s.cold > 0 && <span className="ml-1 text-xs text-muted-foreground">（冷啟動 {s.cold}）</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`最慢的 ${slowRows.length} 次`} description={`超過 ${slowMs / 1000} 秒的單筆請求，最慢的排最上面`}>
        {slowRows.length === 0 ? (
          <EmptyNote>這段期間沒有超過 {slowMs / 1000} 秒的請求。</EmptyNote>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[#E0DCD6] bg-[#F5F1EC] text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">時間</th>
                  <th className="px-4 py-3 font-medium">使用者</th>
                  <th className="px-4 py-3 font-medium">頁面／操作</th>
                  <th className="px-4 py-3 text-right font-medium">耗時</th>
                  <th className="px-4 py-3 font-medium">裝置</th>
                </tr>
              </thead>
              <tbody>
                {slowRows.map((r) => {
                  const person = r.user_id ? people.get(r.user_id) : undefined;
                  return (
                    <tr key={r.id} className="border-b border-[#E0DCD6]/60 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                        {formatTW(r.occurred_at, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td className="px-4 py-2.5">
                        {personText(person, r.user_id)}
                        <span className="ml-1.5 text-xs text-muted-foreground">{roleText(r.role ?? person?.role)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div>{r.kind === "action" ? actionLabel(r.action_name) : routeLabel(r.route)}</div>
                        <div className="text-xs text-muted-foreground">
                          {KIND_LABEL[r.kind] ?? r.kind}・<span className="font-mono">{r.path ?? r.route}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums">
                        {formatMs(r.duration_ms)}
                        {r.cold_start && (
                          <span className="ml-1.5 rounded-full border border-[#E0DCD6] px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                            冷啟動
                          </span>
                        )}
                        {r.status === "error" && (
                          <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] font-normal text-red-700">出錯</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{r.device ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="mb-8 rounded-md border border-[#E0DCD6] bg-[#F5F1EC] p-4 text-sm text-[#5A5050]">
        <p className="font-semibold text-primary">怎麼看這一頁</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>耗時是伺服器端的處理時間，不含使用者手機的網路；工地訊號差時使用者實際等得會更久。</li>
          <li>「冷啟動」是伺服器閒置一陣子後第一個請求，要多花 1–3 秒開機，偶發是正常的。</li>
          <li>同一頁如果「一般」就很慢，通常是查詢太多或沒有平行處理；只有「最慢」很慢多半是冷啟動或網路抖動。</li>
        </ul>
      </div>
    </div>
  );
}
