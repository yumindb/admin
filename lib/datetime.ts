/**
 * 時區工具:全站顯示一律用台灣時間。
 *
 * 為什麼需要:
 *   DB 存 TIMESTAMPTZ(UTC),Next.js Server Components 在 Vercel(UTC)上 render,
 *   呼叫 toLocaleString("zh-TW") 不指定 timeZone 會吃伺服器時區 → 變成 UTC。
 *   所有 user-facing 時間顯示都該走這兩個 helper,自動帶上 Asia/Taipei。
 *
 * 不要在這檔放「以日期當 key 比對」的邏輯(那種要 en-CA + Asia/Taipei 取 YYYY-MM-DD,
 * 已經在 lib/daily-log.ts 處理),這裡只負責給人看的格式化。
 */
const TZ = "Asia/Taipei";

type DateInput = Date | string | number | null | undefined;

function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 日期 + 時間。預設 zh-TW 完整格式,可額外覆寫 options。 */
export function formatTW(input: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  const d = toDate(input);
  if (!d) return "";
  return d.toLocaleString("zh-TW", { timeZone: TZ, ...opts });
}

/** 只要日期,不要時間。 */
export function formatDateTW(input: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  const d = toDate(input);
  if (!d) return "";
  return d.toLocaleDateString("zh-TW", { timeZone: TZ, ...opts });
}

/**
 * 台灣「今天 00:00」的時間點 — 給 `.gte("created_at", …)` 這類查詢當起點。
 *
 * ⚠ 不能用 `new Date().setHours(0, 0, 0, 0)`:Vercel 跑在 UTC,那是台灣早上 8 點,
 * 8 點前的打卡 / 紀錄會被當成昨天(2026-09-26 健檢抓到打卡頁與儀表板都中)。
 * 台灣沒有日光節約時間,固定 +08:00。
 */
export function startOfTodayTaipei(now: Date = new Date()): Date {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: TZ });
  return new Date(`${ymd}T00:00:00+08:00`);
}

/** 台灣「本月 1 號 00:00」 */
export function startOfMonthTaipei(now: Date = new Date()): Date {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: TZ });
  return new Date(`${ymd.slice(0, 8)}01T00:00:00+08:00`);
}

/** 「近 N 天」的起點:今天算第 1 天,往前推到第 N 天的台灣 00:00 */
export function startOfRecentDaysTaipei(days: number, now: Date = new Date()): Date {
  const start = startOfTodayTaipei(now);
  return new Date(start.getTime() - (Math.max(1, days) - 1) * 24 * 60 * 60 * 1000);
}
