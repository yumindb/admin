import { describe, expect, it } from "vitest";
import {
  defaultPayrollSettings,
  hourlyRate,
  parsePayrollSection,
} from "../payroll/settings";
import {
  describePayProfile,
  payProfileOn,
  sortPayProfilesDesc,
  type PayProfile,
} from "../payroll/pay-profiles";
import { dayTypeFor, indexHolidays, isoWeekday } from "../payroll/holidays";

describe("薪資規則 parse 與預設", () => {
  it("空物件 / undefined 一律回勞基法預設", () => {
    const d = defaultPayrollSettings();
    expect(d.work_rules.daily_hours).toBe(8);
    expect(d.work_rules.weekly_days).toBe(5);
    expect(d.overtime.weekday_tiers).toEqual([
      { hours: 2, multiplier: 1.34 },
      { hours: 2, multiplier: 1.67 },
    ]);
    expect(d.overtime.holiday_multiplier).toBe(2);
    expect(d.late.enabled).toBe(false);
    expect(d.bonus.required_days_per_quarter).toBe(60);
    expect(d.bonus.per_day_amount).toBe(200);
    expect(d.leave_pay_ratios.sick).toBe(0.5);
    expect(parsePayrollSection("late", undefined)).toEqual(d.late);
    expect(parsePayrollSection("bonus", null)).toEqual(d.bonus);
  });

  it("缺欄位補預設、有給的欄位保留", () => {
    const r = parsePayrollSection("work_rules", { daily_hours: 7.5 });
    expect(r.daily_hours).toBe(7.5);
    expect(r.weekly_days).toBe(5);
  });

  it("單一欄位壞掉只丟那一欄,其餘保留", () => {
    const r = parsePayrollSection("bonus", {
      per_day_amount: 300,
      required_days_per_quarter: "六十",
    });
    expect(r.per_day_amount).toBe(300);
    expect(r.required_days_per_quarter).toBe(60);
  });

  it("陣列或字串當設定 → 全部預設", () => {
    expect(parsePayrollSection("overtime", [1, 2, 3])).toEqual(
      defaultPayrollSettings().overtime,
    );
    expect(parsePayrollSection("payday", "5")).toEqual({ day_of_month: 5 });
  });

  it("時薪:月薪 ÷ 30 ÷ 8;日薪 ÷ 8", () => {
    const rules = defaultPayrollSettings().work_rules;
    expect(hourlyRate("monthly", 36000, rules)).toBe(150);
    expect(hourlyRate("daily", 1600, rules)).toBe(200);
  });
});

function row(p: Partial<PayProfile> & { effective_from: string }): PayProfile {
  return {
    id: p.id ?? p.effective_from,
    user_id: "u1",
    employment_type: p.employment_type ?? "monthly",
    amount: p.amount ?? 30000,
    note: null,
    created_by: null,
    created_at: p.created_at ?? "2026-01-01T00:00:00Z",
    ...p,
  };
}

describe("員工薪制(append-only 版本)", () => {
  const rows = [
    row({ effective_from: "2026-01-01", amount: 30000 }),
    row({ effective_from: "2026-07-01", amount: 33000 }),
    row({ effective_from: "2027-01-01", amount: 36000 }),
  ];

  it("取 effective_from <= 該日 之中最晚的一列", () => {
    expect(payProfileOn(rows, "2026-06-30")?.amount).toBe(30000);
    expect(payProfileOn(rows, "2026-07-01")?.amount).toBe(33000);
    expect(payProfileOn(rows, "2026-12-31")?.amount).toBe(33000);
    expect(payProfileOn(rows, "2027-03-01")?.amount).toBe(36000);
  });

  it("還沒有任何生效的列 → null", () => {
    expect(payProfileOn(rows, "2025-12-31")).toBeNull();
    expect(payProfileOn([], "2026-01-01")).toBeNull();
  });

  it("同一生效日填兩次 → 取 created_at 最新(打錯重填)", () => {
    const dup = [
      row({ id: "a", effective_from: "2026-01-01", amount: 30000, created_at: "2026-01-01T01:00:00Z" }),
      row({ id: "b", effective_from: "2026-01-01", amount: 31000, created_at: "2026-01-01T02:00:00Z" }),
    ];
    expect(payProfileOn(dup, "2026-02-01")?.id).toBe("b");
    expect(sortPayProfilesDesc(dup).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("一句話描述", () => {
    expect(describePayProfile(row({ effective_from: "2026-01-01", amount: 45000 }))).toBe(
      "正職月薪 45,000 元／月",
    );
    expect(
      describePayProfile(
        row({ effective_from: "2026-01-01", employment_type: "daily", amount: 1800 }),
      ),
    ).toBe("日薪 1,800 元／日");
  });
});

describe("日型別判定", () => {
  const overtime = { rest_day_weekday: 6, regular_off_weekday: 7 };
  const holidays = indexHolidays([
    { holiday_date: "2026-10-09", name: "國慶日補假", is_workday: false },
    { holiday_date: "2026-10-17", name: "補班", is_workday: true },
  ]);

  it("ISO 星期:2026-09-26 是週六", () => {
    expect(isoWeekday("2026-09-26")).toBe(6);
    expect(isoWeekday("2026-09-27")).toBe(7);
    expect(isoWeekday("2026-09-28")).toBe(1);
  });

  it("平日 / 休息日 / 例假日 / 國定假日 / 補班日", () => {
    expect(dayTypeFor("2026-09-28", holidays, overtime)).toBe("workday");
    expect(dayTypeFor("2026-09-26", holidays, overtime)).toBe("rest_day");
    expect(dayTypeFor("2026-09-27", holidays, overtime)).toBe("regular_off");
    expect(dayTypeFor("2026-10-09", holidays, overtime)).toBe("holiday");
    expect(dayTypeFor("2026-10-17", holidays, overtime)).toBe("workday");
  });

  it("休息日 / 例假日可以調(餐飲週一店休)", () => {
    expect(dayTypeFor("2026-09-28", holidays, { rest_day_weekday: 1, regular_off_weekday: 2 })).toBe(
      "rest_day",
    );
  });
});
