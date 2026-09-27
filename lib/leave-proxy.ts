import type { LeaveStatus, UserRole } from "@/lib/types";

/**
 * 請假代理人(migration-2.43)— 純函式,client / server 都可 import,有測試。
 *
 * 2026-09 Phil 反映:工地主任請假那幾天沒人能送施工日誌。
 * → 主任請假時指定一位現場人員當代理人,請假期間由代理人填表、簽名、送出。
 *
 * 規則(資料庫的 is_log_proxy() / has_proxy_duty() 是同一套,改一邊要改另一邊):
 *   - 只有工地主任的假單能指定代理人;代理人是啟用中的現場人員
 *     (其他主任本來就能替任何案件寫日誌,不需要指定)
 *   - 假單「簽核中」或「已核准」代理就生效 — 等全部簽完才能送,日誌又卡住了;
 *     退回 / 取消 → 代理失效
 *   - 代理人只能填請假期間那幾天(台北日期)的日誌
 *   - 代理入口開到請假最後一天 + PROXY_GRACE_DAYS(隔天早上補最後一天的日誌)
 */

/** 請假結束後,代理入口再開幾天(資料庫 has_proxy_duty() 寫死同一個數字) */
export const PROXY_GRACE_DAYS = 3;

/** 代理任務在請假開始前幾天就先讓代理人看到「即將代理」 */
export const PROXY_LOOKAHEAD_DAYS = 7;

/** 假單在這些狀態時,代理人有效 */
export const PROXY_ACTIVE_STATUSES: readonly LeaveStatus[] = ["pending", "approved"];

/** 請假已經結束了嗎(結束後就不能再改代理人) */
export function isLeaveOver(endAt: string, nowMs: number = Date.now()): boolean {
  return new Date(endAt).getTime() <= nowMs;
}

/** 誰的假單可以指定代理人 */
export function canDesignateProxy(role: UserRole): boolean {
  return role === "site_supervisor";
}

/** 誰可以被指定為代理人 */
export function canBeProxy(role: UserRole): boolean {
  return role === "field_assistant";
}

/** timestamptz(ISO)→ 台北日期 YYYY-MM-DD */
export function taipeiDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/** YYYY-MM-DD 加減天數(純日期運算,不受時區影響) */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * 請假涵蓋的台北日期。結束時間剛好 00:00 的那天不算
 * (9/28 09:00 ~ 10/1 00:00 = 9/28、9/29、9/30)— 跟資料庫一樣先減 1 秒再取日期。
 */
export function leaveDateRange(
  startAt: string,
  endAt: string,
): { startDate: string; endDate: string } {
  const endMs = new Date(endAt).getTime() - 1000;
  return {
    startDate: taipeiDate(startAt),
    endDate: taipeiDate(new Date(endMs).toISOString()),
  };
}

export type DateWindow = { startDate: string; endDate: string };

/** 這天在不在請假期間內(代理人能不能填這天的日誌) */
export function windowCoversDate(w: DateWindow, date: string): boolean {
  return date >= w.startDate && date <= w.endDate;
}

/** 今天代理入口開著嗎(請假第一天 ~ 最後一天 + 寬限) */
export function isWindowActive(w: DateWindow, today: string): boolean {
  return today >= w.startDate && today <= addDaysToDate(w.endDate, PROXY_GRACE_DAYS);
}

/** 還沒開始、但 PROXY_LOOKAHEAD_DAYS 內就要開始 */
export function isWindowUpcoming(w: DateWindow, today: string): boolean {
  return today < w.startDate && w.startDate <= addDaysToDate(today, PROXY_LOOKAHEAD_DAYS);
}

/** 代理日誌的預設日期:今天在請假期間內就用今天,過了就用最後一天,還沒到就用第一天 */
export function defaultProxyLogDate(w: DateWindow, today: string): string {
  if (today < w.startDate) return w.startDate;
  if (today > w.endDate) return w.endDate;
  return today;
}

/** YYYY-MM-DD → 「9/28」 */
export function formatShortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 「9/28–9/30」;同一天只寫「9/28」 */
export function formatDateWindow(w: DateWindow): string {
  return w.startDate === w.endDate
    ? formatShortDate(w.startDate)
    : `${formatShortDate(w.startDate)}–${formatShortDate(w.endDate)}`;
}

/** 代理入口最後一天(請假最後一天 + 寬限) */
export function proxyGraceEnd(w: DateWindow): string {
  return addDaysToDate(w.endDate, PROXY_GRACE_DAYS);
}

/** 填表人顯示:「王小明（代理 陳主任）」;不是代理日誌就只有名字 */
export function formatProxyFiller(
  fillerName: string,
  proxyForName: string | null | undefined,
): string {
  return proxyForName ? `${fillerName}（代理 ${proxyForName}）` : fillerName;
}

/** 代理人看到的一筆代理任務(不含假別、事由 — 那是主任的隱私) */
export type ProxyDelegation = DateWindow & {
  leaveId: string;
  supervisorId: string;
  supervisorName: string;
  status: "pending" | "approved";
};

/** 代理人自己的代理任務依今天分成「進行中(含寬限)」與「即將開始」,其餘不顯示 */
export function splitDelegations(
  list: ProxyDelegation[],
  today: string,
): { active: ProxyDelegation[]; upcoming: ProxyDelegation[] } {
  const active: ProxyDelegation[] = [];
  const upcoming: ProxyDelegation[] = [];
  for (const d of list) {
    if (isWindowActive(d, today)) active.push(d);
    else if (isWindowUpcoming(d, today)) upcoming.push(d);
  }
  const byStart = (a: ProxyDelegation, b: ProxyDelegation) =>
    a.startDate.localeCompare(b.startDate);
  return { active: active.sort(byStart), upcoming: upcoming.sort(byStart) };
}
