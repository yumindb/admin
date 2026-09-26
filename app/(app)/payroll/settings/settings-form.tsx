"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LEAVE_TYPE_LABEL } from "@/lib/leave";
import {
  PAYROLL_SECTION_LABEL,
  WEEKDAY_LABEL,
  type BonusRules,
  type DayOffRules,
  type LateRules,
  type LeavePayRatios,
  type OvertimeRules,
  type PaydayRules,
  type PayrollSettingSection,
  type PayrollSettings,
  type WorkRules,
} from "@/lib/payroll/settings";
import { EMPLOYMENT_TYPE_LABEL } from "@/lib/payroll/pay-profiles";
import type { LeaveType } from "@/lib/types";
import { savePayrollSettingAction } from "../actions";

const LEAVE_TYPES = Object.keys(LEAVE_TYPE_LABEL) as LeaveType[];

/* ------------------------------------------------------------------ */
/* 小元件                                                              */
/* ------------------------------------------------------------------ */

/**
 * 數字欄位:內部用字串,讓使用者可以打到一半(例如「1.」);
 * 只有能 parse 成數字時才往外送。
 */
function NumField({
  id,
  label,
  value,
  onChange,
  suffix,
  help,
  step = "any",
  min,
  error,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  help?: string;
  step?: string;
  min?: number;
  error?: string;
}) {
  const [text, setText] = useState(String(value));
  // 父層換了值(例如儲存後回填 parse 過的 1.340 → 1.34)才同步顯示;
  // 在 render 期間調整 state,不用 effect(避免多一輪 render)
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
          }}
          className={`h-10 max-w-[10rem] md:h-10 ${error ? "border-[#FCA5A5]" : ""}`}
        />
        {suffix && <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-[#B91C1C]">{error}</p>
      ) : help ? (
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      ) : null}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-[#003153]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {help && <span className="block text-xs text-muted-foreground">{help}</span>}
      </span>
    </label>
  );
}

type Errors = Record<string, string[]> | undefined;

function SectionCard({
  section,
  description,
  value,
  children,
  onSaved,
}: {
  section: PayrollSettingSection;
  description: string;
  value: unknown;
  children: (errors: Errors) => React.ReactNode;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Errors>(undefined);

  function save() {
    startTransition(async () => {
      const res = await savePayrollSettingAction({ section, value });
      if (res.ok) {
        setErrors(undefined);
        toast.success(`已儲存「${PAYROLL_SECTION_LABEL[section]}」`);
        onSaved?.();
        router.refresh();
      } else {
        setErrors(res.fieldErrors);
        toast.error(res.error);
      }
    });
  }

  return (
    <section className="rounded-md border border-[#E0DCD6] bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#F0EBE4] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-primary">{PAYROLL_SECTION_LABEL[section]}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="button" onClick={save} disabled={isPending} size="sm">
          {isPending ? "儲存中…" : "儲存這一組"}
        </Button>
      </div>
      <div className="space-y-4 px-5 py-4">{children(errors)}</div>
    </section>
  );
}

function firstError(errors: Errors, key: string): string | undefined {
  return errors?.[key]?.[0];
}

/* ------------------------------------------------------------------ */
/* 分段倍率表(平日 / 休息日共用)                                        */
/* ------------------------------------------------------------------ */

function TierEditor({
  title,
  help,
  tiers,
  onChange,
  prefix,
  errors,
}: {
  title: string;
  help: string;
  tiers: { hours: number; multiplier: number }[];
  onChange: (t: { hours: number; multiplier: number }[]) => void;
  prefix: string;
  errors: Errors;
}) {
  // 每一段的起點小時 = 前面幾段的累計
  const starts = tiers.reduce<number[]>((acc, t, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + tiers[i - 1].hours);
    return acc;
  }, []);
  return (
    <div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mb-2 text-xs text-muted-foreground">{help}</p>
      <div className="space-y-2">
        {tiers.map((t, i) => {
          const from = starts[i];
          const to = from + t.hours;
          return (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-md border border-[#F0EBE4] bg-white px-3 py-2"
            >
              <span className="w-28 shrink-0 text-xs text-muted-foreground">
                第 {from + 1}–{to} 小時
              </span>
              <NumField
                id={`${prefix}-h-${i}`}
                label="涵蓋"
                value={t.hours}
                min={0}
                onChange={(n) => onChange(tiers.map((x, j) => (j === i ? { ...x, hours: n } : x)))}
                suffix="小時"
                error={firstError(errors, `${prefix}.${i}.hours`)}
              />
              <NumField
                id={`${prefix}-m-${i}`}
                label="倍率"
                value={t.multiplier}
                step="0.01"
                min={1}
                onChange={(n) =>
                  onChange(tiers.map((x, j) => (j === i ? { ...x, multiplier: n } : x)))
                }
                suffix="× 時薪"
                error={firstError(errors, `${prefix}.${i}.multiplier`)}
              />
              {tiers.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(tiers.filter((_, j) => j !== i))}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] px-2 py-1 text-xs text-[#B91C1C] hover:bg-[#FEF2F2]"
                >
                  <Trash2 className="size-3" /> 移除
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onChange([...tiers, { hours: 2, multiplier: 2 }])}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-foreground hover:border-accent hover:text-accent"
      >
        <Plus className="size-3" /> 再加一段
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 主表單                                                              */
/* ------------------------------------------------------------------ */

export function PayrollSettingsForm({ initial }: { initial: PayrollSettings }) {
  const [work, setWork] = useState<WorkRules>(initial.work_rules);
  const [ot, setOt] = useState<OvertimeRules>(initial.overtime);
  const [late, setLate] = useState<LateRules>(initial.late);
  const [ratios, setRatios] = useState<LeavePayRatios>(initial.leave_pay_ratios);
  const [bonus, setBonus] = useState<BonusRules>(initial.bonus);
  const [payday, setPayday] = useState<PaydayRules>(initial.payday);
  const [dayOff, setDayOff] = useState<DayOffRules>(initial.day_off);

  // 季覆寫用陣列編輯,存的時候再轉成物件
  const [overrides, setOverrides] = useState<{ quarter: string; days: number }[]>(() =>
    Object.entries(initial.bonus.quarter_overrides).map(([quarter, days]) => ({ quarter, days })),
  );
  const bonusValue: BonusRules = {
    ...bonus,
    quarter_overrides: Object.fromEntries(
      overrides.filter((o) => /^\d{4}-Q[1-4]$/.test(o.quarter.trim())).map((o) => [o.quarter.trim(), o.days]),
    ),
  };

  return (
    <div className="space-y-6">
      <SectionCard
        section="work_rules"
        description="正常工時、換算時薪的除數、自動扣休息、加班計算單位"
        value={work}
      >
        {(errors) => (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <NumField
              id="daily_hours"
              label="每日正常工時"
              value={work.daily_hours}
              onChange={(n) => setWork({ ...work, daily_hours: n })}
              suffix="小時"
              help="超過這個時數的部分算加班"
              error={firstError(errors, "daily_hours")}
            />
            <NumField
              id="weekly_days"
              label="每週工作日數"
              value={work.weekly_days}
              step="1"
              onChange={(n) => setWork({ ...work, weekly_days: n })}
              suffix="天"
              error={firstError(errors, "weekly_days")}
            />
            <NumField
              id="monthly_divisor_days"
              label="月薪換時薪的除數"
              value={work.monthly_divisor_days}
              onChange={(n) => setWork({ ...work, monthly_divisor_days: n })}
              suffix="天"
              help="時薪 = 月薪 ÷ 這個數 ÷ 每日正常工時(勞動部慣例 30)"
              error={firstError(errors, "monthly_divisor_days")}
            />
            <NumField
              id="ot_unit_minutes"
              label="加班計算單位"
              value={work.ot_unit_minutes}
              step="1"
              onChange={(n) => setWork({ ...work, ot_unit_minutes: n })}
              suffix="分鐘"
              help="1 = 以分計、不捨去(法規要求);30 = 以半小時為單位"
              error={firstError(errors, "ot_unit_minutes")}
            />
            <NumField
              id="auto_break_after_hours"
              label="單段工作超過幾小時自動扣休息"
              value={work.auto_break_after_hours}
              onChange={(n) => setWork({ ...work, auto_break_after_hours: n })}
              suffix="小時"
              help="沒有排班別時用;0 = 不自動扣"
              error={firstError(errors, "auto_break_after_hours")}
            />
            <NumField
              id="auto_break_minutes"
              label="自動扣的休息時間"
              value={work.auto_break_minutes}
              step="1"
              onChange={(n) => setWork({ ...work, auto_break_minutes: n })}
              suffix="分鐘"
              error={firstError(errors, "auto_break_minutes")}
            />
            <NumField
              id="monthly_ot_cap_hours"
              label="每月加班上限"
              value={work.monthly_ot_cap_hours}
              onChange={(n) => setWork({ ...work, monthly_ot_cap_hours: n })}
              suffix="小時"
              help="超過只在月結頁警告,不會擋"
              error={firstError(errors, "monthly_ot_cap_hours")}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard
        section="overtime"
        description="平日延長、休息日、例假日與國定假日出勤怎麼算"
        value={ot}
      >
        {(errors) => (
          <div className="space-y-5">
            <TierEditor
              title="平日加班(超過每日正常工時之後)"
              help="勞基法:前 2 小時加給 1/3(×1.34),再 2 小時加給 2/3(×1.67)"
              tiers={ot.weekday_tiers}
              onChange={(t) => setOt({ ...ot, weekday_tiers: t })}
              prefix="weekday_tiers"
              errors={errors}
            />
            <TierEditor
              title="休息日出勤(從第 1 小時起算)"
              help="勞基法:前 2 小時 ×1.34,第 3–8 小時 ×1.67,第 9–12 小時 ×2.67"
              tiers={ot.rest_day_tiers}
              onChange={(t) => setOt({ ...ot, rest_day_tiers: t })}
              prefix="rest_day_tiers"
              errors={errors}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <NumField
                id="holiday_multiplier"
                label="例假日 / 國定假日出勤倍率"
                value={ot.holiday_multiplier}
                step="0.01"
                onChange={(n) => setOt({ ...ot, holiday_multiplier: n })}
                suffix="× 時薪"
                help="勞基法:加發一日工資(×2)"
                error={firstError(errors, "holiday_multiplier")}
              />
              <div>
                <Label htmlFor="rest_day_weekday">休息日是</Label>
                <select
                  id="rest_day_weekday"
                  value={ot.rest_day_weekday}
                  onChange={(e) => setOt({ ...ot, rest_day_weekday: Number(e.target.value) })}
                  className="mt-1 h-10 w-full max-w-[10rem] rounded-md border border-[#E0DCD6] bg-white px-3 text-sm"
                >
                  {Object.entries(WEEKDAY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">一週 5 日制的第 6 天</p>
              </div>
              <div>
                <Label htmlFor="regular_off_weekday">例假日是</Label>
                <select
                  id="regular_off_weekday"
                  value={ot.regular_off_weekday}
                  onChange={(e) => setOt({ ...ot, regular_off_weekday: Number(e.target.value) })}
                  className="mt-1 h-10 w-full max-w-[10rem] rounded-md border border-[#E0DCD6] bg-white px-3 text-sm"
                >
                  {Object.entries(WEEKDAY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">餐飲店休可以改成別天</p>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        section="late"
        description="裕民目前不扣遲到;機制先做好,要用再打開"
        value={late}
      >
        {(errors) => (
          <div className="space-y-4">
            <Toggle
              checked={late.enabled}
              onChange={(v) => setLate({ ...late, enabled: v })}
              label="啟用遲到扣款"
              help="關閉時月結頁仍會標出遲到,只是不扣錢"
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <NumField
                id="grace_minutes"
                label="寬限"
                value={late.grace_minutes}
                step="1"
                onChange={(n) => setLate({ ...late, grace_minutes: n })}
                suffix="分鐘"
                help="排定上班時間加這個分鐘數以內不算遲到"
                error={firstError(errors, "grace_minutes")}
              />
              <div>
                <Label>扣法</Label>
                <div className="mt-2 space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="late_mode"
                      checked={late.mode === "per_minute"}
                      onChange={() => setLate({ ...late, mode: "per_minute" })}
                      className="accent-[#003153]"
                    />
                    依時薪按實際遲到分鐘扣
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="late_mode"
                      checked={late.mode === "fixed"}
                      onChange={() => setLate({ ...late, mode: "fixed" })}
                      className="accent-[#003153]"
                    />
                    每次遲到扣固定金額
                  </label>
                </div>
              </div>
              <NumField
                id="fixed_amount"
                label="固定金額"
                value={late.fixed_amount}
                step="1"
                onChange={(n) => setLate({ ...late, fixed_amount: n })}
                suffix="元／次"
                error={firstError(errors, "fixed_amount")}
              />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        section="leave_pay_ratios"
        description="月薪人員請假時該假別給幾成薪(接現有的請假單)"
        value={ratios}
      >
        {(errors) => (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {LEAVE_TYPES.map((t) => (
              <NumField
                key={t}
                id={`ratio-${t}`}
                label={LEAVE_TYPE_LABEL[t]}
                value={Math.round(ratios[t] * 100)}
                step="1"
                min={0}
                onChange={(n) => setRatios({ ...ratios, [t]: Math.min(100, Math.max(0, n)) / 100 })}
                suffix="% 薪"
                error={firstError(errors, t)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        section="bonus"
        description="每季出勤天數達門檻 → 出勤天數 × 每日金額;季末後第 N 個月隨薪資發"
        value={bonusValue}
      >
        {(errors) => (
          <div className="space-y-4">
            <Toggle
              checked={bonus.enabled}
              onChange={(v) => setBonus({ ...bonus, enabled: v })}
              label="發放季績效獎金"
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <NumField
                id="per_day_amount"
                label="每個出勤日"
                value={bonus.per_day_amount}
                step="1"
                onChange={(n) => setBonus({ ...bonus, per_day_amount: n })}
                suffix="元"
                error={firstError(errors, "per_day_amount")}
              />
              <NumField
                id="required_days_per_quarter"
                label="每季滿勤門檻"
                value={bonus.required_days_per_quarter}
                step="1"
                onChange={(n) => setBonus({ ...bonus, required_days_per_quarter: n })}
                suffix="天"
                help="13 週 × 5 天 = 65,扣國定假日約 60–63;春節那季可在下面另外覆寫"
                error={firstError(errors, "required_days_per_quarter")}
              />
              <NumField
                id="payout_month_offset"
                label="季末後第幾個月發"
                value={bonus.payout_month_offset}
                step="1"
                onChange={(n) => setBonus({ ...bonus, payout_month_offset: n })}
                suffix="個月"
                help="2 → 第一季(1–3 月)跟 5 月薪資一起在 6 月發薪日發"
                error={firstError(errors, "payout_month_offset")}
              />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">這些假別視同出勤</div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {LEAVE_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={bonus.counted_leave_types.includes(t)}
                      onChange={(e) =>
                        setBonus({
                          ...bonus,
                          counted_leave_types: e.target.checked
                            ? [...bonus.counted_leave_types, t]
                            : bonus.counted_leave_types.filter((x) => x !== t),
                        })
                      }
                      className="size-4 accent-[#003153]"
                    />
                    {LEAVE_TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">哪些人有季獎金</div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {(["monthly", "daily"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={bonus.eligible_employment_types.includes(t)}
                      onChange={(e) =>
                        setBonus({
                          ...bonus,
                          eligible_employment_types: e.target.checked
                            ? [...bonus.eligible_employment_types, t]
                            : bonus.eligible_employment_types.filter((x) => x !== t),
                        })
                      }
                      className="size-4 accent-[#003153]"
                    />
                    {EMPLOYMENT_TYPE_LABEL[t]}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">特定季的門檻覆寫</div>
              <p className="mb-2 text-xs text-muted-foreground">
                例如春節那季工作天數少,填 2026-Q1 → 55。沒填的季用上面的門檻。
              </p>
              <div className="space-y-2">
                {overrides.map((o, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-end gap-2 rounded-md border border-[#F0EBE4] bg-white px-3 py-2"
                  >
                    <div>
                      <Label htmlFor={`ov-q-${i}`}>季</Label>
                      <Input
                        id={`ov-q-${i}`}
                        value={o.quarter}
                        placeholder="2026-Q1"
                        onChange={(e) =>
                          setOverrides(overrides.map((x, j) => (j === i ? { ...x, quarter: e.target.value } : x)))
                        }
                        className="mt-1 h-10 max-w-[9rem] md:h-10"
                      />
                    </div>
                    <NumField
                      id={`ov-d-${i}`}
                      label="門檻"
                      value={o.days}
                      step="1"
                      onChange={(n) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, days: n } : x)))}
                      suffix="天"
                    />
                    <button
                      type="button"
                      onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] px-2 py-1 text-xs text-[#B91C1C] hover:bg-[#FEF2F2]"
                    >
                      <Trash2 className="size-3" /> 移除
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setOverrides([...overrides, { quarter: "", days: bonus.required_days_per_quarter }])}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-[#E0DCD6] bg-white px-2.5 py-1 text-xs text-foreground hover:border-accent hover:text-accent"
              >
                <Plus className="size-3" /> 新增覆寫
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard section="day_off" description="員工在班表排出來前標「這天不能上」;不簽核,只是給排班的人看" value={dayOff}>
        {(errors) => (
          <div className="space-y-4">
            <Toggle
              checked={dayOff.enabled}
              onChange={(v) => setDayOff({ ...dayOff, enabled: v })}
              label="開放員工標排休"
              help="關掉後打卡頁不顯示排休卡;已標的保留"
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <NumField
                id="monthly_cap"
                label="每月上限"
                value={dayOff.monthly_cap}
                step="1"
                onChange={(n) => setDayOff({ ...dayOff, monthly_cap: n })}
                suffix="天"
                help="0 = 不限制;餐飲常設 4–8"
                error={firstError(errors, "monthly_cap")}
              />
              <NumField
                id="deadline_day"
                label="截止日"
                value={dayOff.deadline_day}
                step="1"
                onChange={(n) => setDayOff({ ...dayOff, deadline_day: n })}
                suffix="號前標下個月"
                help="0 = 不限制;例如 20 → 9/20 之後不能再標 10 月"
                error={firstError(errors, "deadline_day")}
              />
              <NumField
                id="min_days_ahead"
                label="至少提前"
                value={dayOff.min_days_ahead}
                step="1"
                onChange={(n) => setDayOff({ ...dayOff, min_days_ahead: n })}
                suffix="天"
                help="1 = 明天起可標,今天不行"
                error={firstError(errors, "min_days_ahead")}
              />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard section="payday" description="每月幾號發上個月薪資(季獎金也跟著這天)" value={payday}>
        {(errors) => (
          <NumField
            id="day_of_month"
            label="發薪日"
            value={payday.day_of_month}
            step="1"
            onChange={(n) => setPayday({ day_of_month: n })}
            suffix="號"
            help="1–28 之間,避開 29–31 號沒有的月份"
            error={firstError(errors, "day_of_month")}
          />
        )}
      </SectionCard>
    </div>
  );
}
