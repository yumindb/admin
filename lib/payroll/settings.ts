import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSettings } from "@/lib/settings";
import type { LeaveType } from "@/lib/types";

/**
 * 薪資規則(app_settings 的 payroll.* 六組,migration-2.40)。
 *
 * 原則:**所有規則都是設定,不寫死在程式裡** — 業主明說這套之後可能給餐飲分公司用。
 * 每個欄位都有 zod `.default()`,所以:
 *   - migration 沒跑 / 那列被刪 / 缺欄位 → 一律回預設值(勞基法一例一休的倍率)
 *   - 設定頁存進去的是完整物件;讀出來再 parse 一次補洞
 *
 * 預設值的依據(2026-09-26 Evelyn 拍板「用合理倍率」):
 *   - 平日延長工時:前 2 小時加給 1/3(×1.34)、再 2 小時加給 2/3(×1.67)
 *   - 休息日(一週 5 日制的第 6 天,預設週六):前 2 小時 ×1.34、第 3–8 小時 ×1.67、第 9–12 小時 ×2.67
 *   - 例假日(預設週日)與國定假日出勤:加發一日工資(×2)
 *   - 時薪基準:月薪 ÷ 30 ÷ 8;日薪 ÷ 8
 *   - 遲到扣款:機制在、預設關(裕民不扣)
 *   - 季獎金:每季出勤達 60 天(13 週 × 5 天 = 65,扣國定假日)→ 出勤天數 × 200,Q1 隨 5 月薪資在 6/5 發
 */

export const PAYROLL_SETTING_KEYS = {
  work_rules: "payroll.work_rules",
  overtime: "payroll.overtime",
  late: "payroll.late",
  leave_pay_ratios: "payroll.leave_pay_ratios",
  bonus: "payroll.bonus",
  payday: "payroll.payday",
} as const;

export type PayrollSettingSection = keyof typeof PAYROLL_SETTING_KEYS;

export const WorkRulesSchema = z.object({
  /** 每日正常工時(小時),超過的部分算加班 */
  daily_hours: z.number().min(1).max(24).default(8),
  /** 每週工作日數 */
  weekly_days: z.number().int().min(1).max(7).default(5),
  /** 月薪換時薪的除數:月薪 ÷ 這個數 ÷ daily_hours(勞動部慣例 30) */
  monthly_divisor_days: z.number().min(1).max(31).default(30),
  /** 單一工作段超過幾小時就自動扣休息(沒有班別範本時用);0 = 不自動扣 */
  auto_break_after_hours: z.number().min(0).max(24).default(6),
  /** 自動扣的休息分鐘數 */
  auto_break_minutes: z.number().int().min(0).max(240).default(60),
  /** 加班計算單位(分鐘):1 = 以分計、不捨去(法規要求);30 = 以半小時為單位 */
  ot_unit_minutes: z.number().int().min(1).max(60).default(1),
  /** 每月加班上限(小時),超過只在月結頁警告、不擋 */
  monthly_ot_cap_hours: z.number().min(0).max(300).default(46),
});

const TierSchema = z.object({
  /** 這一段涵蓋幾小時 */
  hours: z.number().positive().max(24),
  /** 這一段的時薪倍率 */
  multiplier: z.number().min(1).max(10),
});

export const OvertimeSchema = z.object({
  /** 平日超過 daily_hours 之後,依序套用的分段倍率 */
  weekday_tiers: z
    .array(TierSchema)
    .min(1)
    .default([
      { hours: 2, multiplier: 1.34 },
      { hours: 2, multiplier: 1.67 },
    ]),
  /** 休息日出勤:從第 1 小時起分段 */
  rest_day_tiers: z
    .array(TierSchema)
    .min(1)
    .default([
      { hours: 2, multiplier: 1.34 },
      { hours: 6, multiplier: 1.67 },
      { hours: 4, multiplier: 2.67 },
    ]),
  /** 例假日 / 國定假日出勤的倍率(整天) */
  holiday_multiplier: z.number().min(1).max(10).default(2),
  /** 哪一天是休息日(ISO 星期:1 = 週一 … 7 = 週日) */
  rest_day_weekday: z.number().int().min(1).max(7).default(6),
  /** 哪一天是例假日 */
  regular_off_weekday: z.number().int().min(1).max(7).default(7),
});

export const LateSchema = z.object({
  /** 要不要扣遲到。裕民預設不扣 */
  enabled: z.boolean().default(false),
  /** 寬限分鐘:排定上班時間 + 這個分鐘數以內不算遲到 */
  grace_minutes: z.number().int().min(0).max(120).default(10),
  /** per_minute = 依時薪按實際遲到分鐘扣;fixed = 每次遲到扣固定金額 */
  mode: z.enum(["per_minute", "fixed"]).default("per_minute"),
  fixed_amount: z.number().int().min(0).default(0),
});

const ratio = () => z.number().min(0).max(1);

/** 各假別給薪比例:1 = 全薪、0.5 = 半薪、0 = 不給薪(月薪人員請假扣薪用) */
export const LeavePayRatiosSchema = z.object({
  personal: ratio().default(0),
  sick: ratio().default(0.5),
  official: ratio().default(1),
  annual: ratio().default(1),
  menstrual: ratio().default(0.5),
  bereavement: ratio().default(1),
  marriage: ratio().default(1),
  other: ratio().default(0),
}) satisfies z.ZodType<Record<LeaveType, number>, unknown>;

export const BonusSchema = z.object({
  enabled: z.boolean().default(true),
  /** 達標後每個出勤日發多少 */
  per_day_amount: z.number().int().min(0).default(200),
  /** 該季出勤幾天才算滿勤 */
  required_days_per_quarter: z.number().int().min(0).max(92).default(60),
  /** 這些假別的天數視同出勤(例:特休、公假) */
  counted_leave_types: z
    .array(
      z.enum([
        "personal",
        "sick",
        "official",
        "annual",
        "menstrual",
        "bereavement",
        "marriage",
        "other",
      ]),
    )
    .default(["annual", "official"]),
  /** 季末後第幾個月隨薪資發:2 → Q1(1–3 月)跟 5 月薪資一起在 6 月發薪日發 */
  payout_month_offset: z.number().int().min(0).max(12).default(2),
  /** 特定季的門檻覆寫,key 形如 "2026-Q1"(春節那季工作天數少) */
  quarter_overrides: z.record(z.string(), z.number().int().min(0).max(92)).default({}),
  /** 哪些雇用類型有季獎金 */
  eligible_employment_types: z
    .array(z.enum(["monthly", "daily"]))
    .default(["monthly", "daily"]),
});

export const PaydaySchema = z.object({
  /** 每月幾號發上個月薪資 */
  day_of_month: z.number().int().min(1).max(28).default(5),
});

export const PAYROLL_SCHEMAS = {
  work_rules: WorkRulesSchema,
  overtime: OvertimeSchema,
  late: LateSchema,
  leave_pay_ratios: LeavePayRatiosSchema,
  bonus: BonusSchema,
  payday: PaydaySchema,
} as const;

export type WorkRules = z.infer<typeof WorkRulesSchema>;
export type OvertimeRules = z.infer<typeof OvertimeSchema>;
export type LateRules = z.infer<typeof LateSchema>;
export type LeavePayRatios = z.infer<typeof LeavePayRatiosSchema>;
export type BonusRules = z.infer<typeof BonusSchema>;
export type PaydayRules = z.infer<typeof PaydaySchema>;

export type PayrollSettings = {
  work_rules: WorkRules;
  overtime: OvertimeRules;
  late: LateRules;
  leave_pay_ratios: LeavePayRatios;
  bonus: BonusRules;
  payday: PaydayRules;
};

/** 設定頁 / DB description 用的中文名 */
export const PAYROLL_SECTION_LABEL: Record<PayrollSettingSection, string> = {
  work_rules: "工時基本規則",
  overtime: "加班倍率",
  late: "遲到扣款",
  leave_pay_ratios: "請假給薪比例",
  bonus: "季績效獎金",
  payday: "發薪日",
};

/**
 * 把 DB 裡的 jsonb(可能是 undefined / 舊版結構 / 手改壞掉)parse 成完整物件。
 * 失敗一律回預設 — 規則不該因為一筆設定壞掉就變成另一套。
 */
export function parsePayrollSection<S extends PayrollSettingSection>(
  section: S,
  raw: unknown,
): PayrollSettings[S] {
  const schema = PAYROLL_SCHEMAS[section];
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = schema.safeParse(input);
  if (result.success) return result.data as PayrollSettings[S];
  // 部分欄位壞掉:只丟壞掉的欄位,其餘保留
  const cleaned: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const issue of result.error.issues) {
    const top = issue.path[0];
    if (typeof top === "string") delete cleaned[top];
  }
  const retry = schema.safeParse(cleaned);
  return (retry.success ? retry.data : schema.parse({})) as PayrollSettings[S];
}

export function defaultPayrollSettings(): PayrollSettings {
  return {
    work_rules: WorkRulesSchema.parse({}),
    overtime: OvertimeSchema.parse({}),
    late: LateSchema.parse({}),
    leave_pay_ratios: LeavePayRatiosSchema.parse({}),
    bonus: BonusSchema.parse({}),
    payday: PaydaySchema.parse({}),
  };
}

/** 一次讀六組(單一查詢);任何一組讀不到就用預設 */
export async function loadPayrollSettings(
  supabase: SupabaseClient,
): Promise<PayrollSettings> {
  const raw = await readSettings(supabase, Object.values(PAYROLL_SETTING_KEYS));
  const out = defaultPayrollSettings();
  for (const section of Object.keys(PAYROLL_SETTING_KEYS) as PayrollSettingSection[]) {
    const key = PAYROLL_SETTING_KEYS[section];
    (out as Record<string, unknown>)[section] = parsePayrollSection(section, raw.get(key));
  }
  return out;
}

/** 時薪:月薪 ÷ 30 ÷ 8;日薪 ÷ 8(除數與工時都來自設定) */
export function hourlyRate(
  employmentType: "monthly" | "daily",
  amount: number,
  rules: WorkRules,
): number {
  if (employmentType === "monthly") {
    return amount / rules.monthly_divisor_days / rules.daily_hours;
  }
  return amount / rules.daily_hours;
}

/** ISO 星期(1 = 週一 … 7 = 週日)的中文 */
export const WEEKDAY_LABEL: Record<number, string> = {
  1: "週一",
  2: "週二",
  3: "週三",
  4: "週四",
  5: "週五",
  6: "週六",
  7: "週日",
};
