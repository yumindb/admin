import type { DailyWeather, LogPhoto } from "./types";

/**
 * 補件:log_date(實際施工日)跟 created_at(系統建立時間)不在同一個自然日(台灣時區)。
 * 隔天才補填的日誌會回 true。
 */
export function isBackfilledLog(log: {
  log_date: string;
  created_at: string;
}): boolean {
  // log_date 是 ISO date string("YYYY-MM-DD"),created_at 是 TIMESTAMPTZ。
  // 把 created_at 轉成台灣時區的 "YYYY-MM-DD" 再比對。
  const createdLocal = new Date(log.created_at).toLocaleDateString("en-CA", {
    timeZone: "Asia/Taipei",
  });
  return log.log_date !== createdLocal;
}

/**
 * 比較某個 timestamp(UTC ISO 字串)在台灣時區下,是否與目標 logDate(YYYY-MM-DD)
 * 是同一天。施工日誌與現場回報用日期匹配時都走這個比對。
 */
export function sameLocalDate(
  iso: string | null | undefined,
  logDate: string,
): boolean {
  if (!iso || !logDate) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const local = d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  return local === logDate;
}

/**
 * 今天在台灣時區的 "YYYY-MM-DD"。
 * 不能用 toISOString().slice(0, 10):那是 UTC 日期,台灣 00:00–07:59 會拿到前一天
 * (client 在台灣裝置上踩到,server 在 Vercel UTC 上必踩)。
 */
export function todayLocalDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/**
 * Daily log 的 photos 欄位歷史上是 string[](僅 path)。新版改成
 * { path, caption }[]。讀取時統一過這個函式,UI 與 PDF 都用 LogPhoto。
 */
export function normalizeLogPhotos(raw: unknown): LogPhoto[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p): LogPhoto | null => {
      if (typeof p === "string") return { path: p, caption: "" };
      if (p && typeof p === "object" && typeof (p as { path?: unknown }).path === "string") {
        const path = (p as { path: string }).path;
        const caption = (p as { caption?: unknown }).caption;
        const original = (p as { original_path?: unknown }).original_path;
        return {
          path,
          caption: typeof caption === "string" ? caption : "",
          ...(typeof original === "string" && original
            ? { original_path: original }
            : {}),
        };
      }
      return null;
    })
    .filter((p): p is LogPhoto => p !== null);
}

export const WEATHER_OPTIONS = ["晴", "多雲", "陰", "小雨", "大雨", "雨停"] as const;

export function parseWeather(raw: string | null | undefined): DailyWeather {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as DailyWeather;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // 舊資料相容:直接把單一字串當成上午天氣
  }
  return { am: raw as DailyWeather["am"] };
}

export function serializeWeather(weather: DailyWeather): string | null {
  if (!weather.am && !weather.pm) return null;
  return JSON.stringify(weather);
}

export function formatWeatherSummary(raw: string | null | undefined): string {
  const weather = parseWeather(raw);
  const parts = [
    weather.am ? `上午 ${weather.am}` : null,
    weather.pm ? `下午 ${weather.pm}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "—";
}

export function getWeekdayLabel(dateLike: string): string {
  const map = ["日", "一", "二", "三", "四", "五", "六"];
  const day = new Date(dateLike).getDay();
  return `星期${map[day] ?? ""}`;
}

export function getRemainingDays(
  expectedEnd: string | null | undefined,
  logDate: string
): number | null {
  if (!expectedEnd) return null;
  const end = new Date(expectedEnd);
  const current = new Date(logDate);
  end.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - current.getTime()) / 86400000);
}

/**
 * 表報編號：`{案件編號}-{YYMMDD}{NN}`，例：`YM-2026-001-26042601`
 *   - NN 是該案件當日第幾份日誌（1 開始，2 位數，01..99）
 *   - caseCode null（罕見：案件沒設編號）→ fallback `YM-未編號`
 */
/**
 * 從歷史日誌算各案件「之前已累計的出工人次」(本日尚未送出的不算)。
 * 累計人次定義 = 所有 submitted/approved 日誌 today_total 的總和。
 *
 * @param logs       已從 daily_logs 撈出的紀錄(建議只含 submitted/approved)
 * @param excludeId  編輯模式時當前正在改的 log_id,避免自我重複計算
 * @returns          caseId → prior_today_total_sum
 */
export function computeManpowerByCase(
  logs: { id: string; case_id: string; today_total: number | null | undefined }[],
  excludeId?: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const l of logs) {
    if (excludeId && l.id === excludeId) continue;
    const n = typeof l.today_total === "number" && Number.isFinite(l.today_total)
      ? l.today_total
      : 0;
    result[l.case_id] = (result[l.case_id] ?? 0) + n;
  }
  return result;
}

/**
 * 從歷史日誌算各案件「之前已累計的點工人次」。
 *
 * 點工(day_labor)是臨時加的人力,只請款不簽合約,所以**不併入**出工人次 —
 * 兩條累計各走各的,報表與 PDF 也分開顯示。
 *
 * @param logs       已從 daily_logs 撈出的紀錄(建議只含 submitted/approved)
 * @param excludeId  編輯模式時當前正在改的 log_id,避免自我重複計算
 * @returns          caseId → prior_day_labor_sum
 */
export function computeDayLaborByCase(
  logs: { id: string; case_id: string; day_labor: number | null | undefined }[],
  excludeId?: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const l of logs) {
    if (excludeId && l.id === excludeId) continue;
    const n =
      typeof l.day_labor === "number" && Number.isFinite(l.day_labor)
        ? l.day_labor
        : 0;
    result[l.case_id] = (result[l.case_id] ?? 0) + n;
  }
  return result;
}

/** 字串正規化作為 trade / machine name 的查詢 key:trim + lowercase。
 *  允許使用者打字時大小寫或前後空白不同也能對到同一筆 */
function normalizeNameKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * 從歷史日誌算各案件「之前已累計的外包工別人次」。
 * 結構:case_id → trade_name_lower → 累計 today 加總。
 */
export function computeSubcontractorTotalsByCase(
  logs: {
    id: string;
    case_id: string;
    subcontractors: { trade?: string | null; today?: number | null }[];
  }[],
  excludeId?: string,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const l of logs) {
    if (excludeId && l.id === excludeId) continue;
    const caseMap = out[l.case_id] ?? {};
    for (const s of l.subcontractors ?? []) {
      const key = normalizeNameKey(s.trade);
      if (!key) continue;
      const n =
        typeof s.today === "number" && Number.isFinite(s.today) ? s.today : 0;
      caseMap[key] = (caseMap[key] ?? 0) + n;
    }
    out[l.case_id] = caseMap;
  }
  return out;
}

/**
 * 從歷史日誌算各案件「之前已累計的機具使用數量」。
 * 結構:case_id → machine_name_lower → 累計 today 加總。
 */
export function computeMachineTotalsByCase(
  logs: {
    id: string;
    case_id: string;
    machines: { name?: string | null; today?: number | null }[];
  }[],
  excludeId?: string,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const l of logs) {
    if (excludeId && l.id === excludeId) continue;
    const caseMap = out[l.case_id] ?? {};
    for (const m of l.machines ?? []) {
      const key = normalizeNameKey(m.name);
      if (!key) continue;
      const n =
        typeof m.today === "number" && Number.isFinite(m.today) ? m.today : 0;
      caseMap[key] = (caseMap[key] ?? 0) + n;
    }
    out[l.case_id] = caseMap;
  }
  return out;
}

/** 給前端 form 用的 trade / machine 名稱查詢 key 正規化函式 */
export const subcontractorKey = normalizeNameKey;

export function buildReportNumber(opts: {
  caseCode: string | null;
  logDate: string; // "YYYY-MM-DD"
  daySeq: number; // 1-based
}): string {
  const yymmdd = opts.logDate.replace(/-/g, "").slice(2); // "260426"
  const prefix = opts.caseCode ?? "YM-未編號";
  const nn = String(Math.max(1, opts.daySeq)).padStart(2, "0");
  return `${prefix}-${yymmdd}${nn}`;
}

