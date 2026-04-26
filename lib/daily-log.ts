import type { DailyWeather } from "./types";

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

export function buildReportNumber(logId: string | undefined, logDate: string): string {
  const day = logDate.replaceAll("-", "");
  if (!logId) return `YM-${day}-NEW`;
  return `YM-${day}-${logId.slice(0, 4).toUpperCase()}`;
}

