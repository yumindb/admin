import type { OvertimeRules } from "./settings";

/**
 * 假日行事曆(holidays,migration-2.40)+ 「這一天是哪種日子」的判定。
 *
 * 日型別決定薪資怎麼算(見 lib/payroll/settings.ts 的 OvertimeSchema):
 *   workday     平日:正常工時內本薪,超過的分段加班
 *   rest_day    休息日(預設週六):從第 1 小時起分段加班
 *   regular_off 例假日(預設週日):出勤 ×holiday_multiplier
 *   holiday     國定假日 / 補假:出勤 ×holiday_multiplier
 *
 * 排班表(Phase B)排了班的日子一律視為 workday — 那是之後 dayTypeFor 要多吃的參數。
 */

export type Holiday = {
  /** YYYY-MM-DD */
  holiday_date: string;
  name: string;
  /** true = 補班日(週六日要上班,算平日) */
  is_workday: boolean;
};

export type DayType = "workday" | "rest_day" | "regular_off" | "holiday";

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  workday: "平日",
  rest_day: "休息日",
  regular_off: "例假日",
  holiday: "國定假日",
};

/** YYYY-MM-DD → ISO 星期(1 = 週一 … 7 = 週日)。日期字串沒有時區問題,用 UTC 算即可 */
export function isoWeekday(dateIso: string): number {
  const day = new Date(`${dateIso}T00:00:00Z`).getUTCDay(); // 0 = 週日
  return day === 0 ? 7 : day;
}

export function dayTypeFor(
  dateIso: string,
  holidaysByDate: ReadonlyMap<string, Holiday>,
  overtime: Pick<OvertimeRules, "rest_day_weekday" | "regular_off_weekday">,
): DayType {
  const h = holidaysByDate.get(dateIso);
  if (h) return h.is_workday ? "workday" : "holiday";
  const wd = isoWeekday(dateIso);
  if (wd === overtime.regular_off_weekday) return "regular_off";
  if (wd === overtime.rest_day_weekday) return "rest_day";
  return "workday";
}

export function indexHolidays(rows: readonly Holiday[]): Map<string, Holiday> {
  const m = new Map<string, Holiday>();
  for (const r of rows) m.set(r.holiday_date, r);
  return m;
}

/** 某一年的假日(含補班日)列表,依日期排 */
export function holidaysInYear(rows: readonly Holiday[], year: number): Holiday[] {
  const prefix = `${year}-`;
  return rows
    .filter((r) => r.holiday_date.startsWith(prefix))
    .sort((a, b) => (a.holiday_date < b.holiday_date ? -1 : 1));
}
