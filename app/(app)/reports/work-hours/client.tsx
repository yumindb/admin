"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { ExcelDownloadButton } from "@/components/excel-download-button";
import { NextStepHint } from "@/components/next-step-hint";
import { LEAVE_TYPE_LABEL, ROLE_LABEL } from "@/lib/leave";
import type { LeaveType, UserRole } from "@/lib/types";
import { DAY_TYPE_LABEL, isoWeekday } from "@/lib/payroll/holidays";
import { WEEKDAY_LABEL, type PayrollSettings } from "@/lib/payroll/settings";
import type { PersonWorkHours } from "@/lib/payroll/work-hours-data";
import { ANOMALY_LABEL, minutesToHoursLabel, taipeiTime } from "@/lib/payroll/work-hours";
import { exportWorkHoursXlsxAction } from "./actions";

const h = minutesToHoursLabel;
const selectCls = "h-10 rounded-md border border-[#E0DCD6] bg-white px-2 text-sm";

export function WorkHoursClient({
  month,
  from,
  to,
  people,
  selected,
  settings,
}: {
  month: string;
  from: string;
  to: string;
  people: PersonWorkHours[];
  selected: PersonWorkHours | null;
  settings: PayrollSettings;
}) {
  const router = useRouter();
  const go = (m: string, u: string | null) => router.push(`/reports/work-hours?month=${m}${u ? `&user=${u}` : ""}`);

  const anomalies = people.flatMap((p) => p.summary.anomalies.map((a) => ({ ...a, user: p.user })));
  anomalies.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const withActivity = people.filter((p) => p.summary.workedMinutes > 0 || p.summary.scheduledDays > 0 || p.summary.anomalies.length > 0);

  return (
    <div className="space-y-6">
      {/* 篩選 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && go(e.target.value, selected?.user.id ?? null)}
          className={selectCls}
          aria-label="月份"
        />
        <select value={selected?.user.id ?? ""} onChange={(e) => go(month, e.target.value || null)} className={selectCls} aria-label="人員">
          <option value="">全部人員(彙總)</option>
          {people.map((p) => (
            <option key={p.user.id} value={p.user.id}>
              {p.user.full_name}（{ROLE_LABEL[p.user.role as UserRole] ?? p.user.role}）
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">{from} ～ {to}</span>
        <div className="ml-auto">
          <ExcelDownloadButton
            label="下載 Excel"
            size="default"
            onFetch={() => exportWorkHoursXlsxAction({ month, userId: selected?.user.id ?? null })}
          />
        </div>
      </div>

      {/* 異常 */}
      <section className="rounded-md border border-[#E0DCD6] bg-card">
        <div className="flex items-center gap-2 border-b border-[#F0EBE4] px-4 py-3">
          <AlertTriangle className={`size-4 ${anomalies.length > 0 ? "text-[#D97706]" : "text-muted-foreground"}`} strokeWidth={1.75} />
          <h2 className="text-base font-semibold text-primary">要先處理的異常</h2>
          <span className="ml-auto text-xs text-muted-foreground">{anomalies.length} 筆</span>
        </div>
        {anomalies.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">這個月沒有漏卡、缺勤。</p>
        ) : (
          <ul className="max-h-72 divide-y divide-[#F0EBE4] overflow-y-auto text-sm">
            {anomalies
              .filter((a) => !selected || a.user.id === selected.user.id)
              .map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{a.date}</span>
                  <span className="font-medium text-foreground">{a.user.full_name}</span>
                  <span className={a.kind === "absent" ? "text-[#B91C1C]" : "text-[#92400E]"}>{ANOMALY_LABEL[a.kind]}</span>
                  <span className="text-xs text-muted-foreground">{a.detail}</span>
                  {a.kind !== "absent" && (
                    <Link
                      href={`/reports/attendance?user=${a.user.id}&from=${a.date}&to=${a.date}`}
                      className="ml-auto text-xs text-primary underline-offset-4 hover:underline"
                    >
                      去補登 →
                    </Link>
                  )}
                </li>
              ))}
          </ul>
        )}
        <div className="border-t border-[#F0EBE4] px-4 py-2 text-xs text-muted-foreground">
          漏卡的那段不算工時,補登後這頁會自動重算。缺勤 = 有排班、沒打卡、也沒有核准的假。
        </div>
      </section>

      {selected ? (
        <PersonDetail person={selected} settings={settings} />
      ) : (
        <SummaryTable people={withActivity} settings={settings} onPick={(id) => go(month, id)} />
      )}
    </div>
  );
}

function SummaryTable({ people, settings, onPick }: { people: PersonWorkHours[]; settings: PayrollSettings; onPick: (id: string) => void }) {
  const leaveTypes = Array.from(new Set(people.flatMap((p) => Object.keys(p.summary.leaveHours)))) as LeaveType[];
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-primary">本月彙總</h2>
        <span className="text-xs text-muted-foreground">
          {people.length} 人有紀錄・時數皆已扣休息・每月加班上限 {settings.work_rules.monthly_ot_cap_hours} 小時
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="bg-[#F5F1EC]/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">姓名</th>
              <th className="px-3 py-2.5 text-right font-medium">排班天</th>
              <th className="px-3 py-2.5 text-right font-medium">出勤天</th>
              <th className="px-3 py-2.5 text-right font-medium">總時數</th>
              <th className="px-3 py-2.5 text-right font-medium">正常</th>
              <th className="px-3 py-2.5 font-medium">平日加班</th>
              <th className="px-3 py-2.5 font-medium">休息日</th>
              <th className="px-3 py-2.5 font-medium">假日出勤</th>
              <th className="px-3 py-2.5 text-right font-medium">加班合計</th>
              <th className="px-3 py-2.5 text-right font-medium">遲到</th>
              <th className="px-3 py-2.5 text-right font-medium">缺勤</th>
              {leaveTypes.map((t) => (
                <th key={t} className="px-3 py-2.5 text-right font-medium">{LEAVE_TYPE_LABEL[t]}</th>
              ))}
              <th className="px-3 py-2.5 text-right font-medium">異常</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EBE4]">
            {people.map((p) => {
              const s = p.summary;
              return (
                <tr key={p.user.id} className="cursor-pointer hover:bg-[#F5F1EC]/40" onClick={() => onPick(p.user.id)}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-primary">{p.user.full_name}</div>
                    <div className="text-[11px] text-muted-foreground">{ROLE_LABEL[p.user.role as UserRole] ?? p.user.role}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.scheduledDays}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.workedDays}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h(s.workedMinutes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h(s.regularMinutes)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{s.weekdayOt.map((o) => `${h(o.minutes)}h×${o.multiplier}`).join(" + ") || "—"}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{s.restDayOt.map((o) => `${h(o.minutes)}h×${o.multiplier}`).join(" + ") || "—"}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{s.holidayMinutes > 0 ? `${h(s.holidayMinutes)}h×${s.holidayMultiplier}` : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${s.otCapExceeded ? "font-semibold text-[#D97706]" : ""}`}>
                    {h(s.totalOtMinutes)}
                    {s.otCapExceeded && <span className="ml-1 text-[11px]">超過</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.lateCount > 0 ? `${s.lateCount} 次／${s.lateMinutes} 分` : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${s.absentDays > 0 ? "text-[#B91C1C]" : ""}`}>{s.absentDays || "—"}</td>
                  {leaveTypes.map((t) => (
                    <td key={t} className="px-3 py-2 text-right tabular-nums">{s.leaveHours[t] ?? "—"}</td>
                  ))}
                  <td className={`px-3 py-2 text-right tabular-nums ${s.anomalies.length > 0 ? "text-[#92400E]" : ""}`}>{s.anomalies.length || "—"}</td>
                </tr>
              );
            })}
            {people.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">這個月還沒有任何打卡或排班</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">點一列看每天的明細。</p>
    </section>
  );
}

function PersonDetail({ person, settings }: { person: PersonWorkHours; settings: PayrollSettings }) {
  const s = person.summary;
  const days = person.days.filter((d) => d.sessions.length > 0 || d.scheduled || d.leave || d.anomalies.length > 0);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-primary">
          {person.user.full_name}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{ROLE_LABEL[person.user.role as UserRole] ?? person.user.role}</span>
        </h2>
        <span className="text-sm text-muted-foreground">
          出勤 {s.workedDays} 天・正常 {h(s.regularMinutes)} 小時・加班 {h(s.totalOtMinutes)} 小時
          {s.otCapExceeded ? `（超過每月 ${settings.work_rules.monthly_ot_cap_hours} 小時上限）` : ""}
          ・遲到 {s.lateCount} 次・缺勤 {s.absentDays} 天
        </span>
      </div>
      {s.otCapExceeded && (
        <NextStepHint tone="warning">加班已超過每月上限,月結時會再提醒;要不要調整由辦公室決定,系統不擋。</NextStepHint>
      )}
      <div className="overflow-x-auto rounded-md border border-[#E0DCD6] bg-card">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-[#F5F1EC]/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">日期</th>
              <th className="px-3 py-2.5 font-medium">日型別</th>
              <th className="px-3 py-2.5 font-medium">排班</th>
              <th className="px-3 py-2.5 font-medium">打卡</th>
              <th className="px-3 py-2.5 text-right font-medium">扣休息後</th>
              <th className="px-3 py-2.5 text-right font-medium">正常</th>
              <th className="px-3 py-2.5 font-medium">加班</th>
              <th className="px-3 py-2.5 text-right font-medium">遲到</th>
              <th className="px-3 py-2.5 text-right font-medium">早退</th>
              <th className="px-3 py-2.5 font-medium">請假</th>
              <th className="px-3 py-2.5 font-medium">異常</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EBE4]">
            {days.map((d) => (
              <tr key={d.date} className={d.anomalies.length > 0 ? "bg-[#FFFBEB]/50" : d.dayType !== "workday" ? "bg-[#EFEAE3]/30" : ""}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {d.date} <span className="text-muted-foreground">{WEEKDAY_LABEL[isoWeekday(d.date)]}</span>
                </td>
                <td className="px-3 py-2 text-xs">{DAY_TYPE_LABEL[d.dayType]}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{d.scheduled ? `${d.scheduled.start}–${d.scheduled.end}` : "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {d.sessions.length === 0
                    ? "—"
                    : d.sessions.map((x, i) => (
                        <span key={i} className="mr-2 whitespace-nowrap">
                          {taipeiTime(x.inAt)}–{x.outAt ? taipeiTime(x.outAt) : <span className="text-[#B91C1C]">？</span>}
                          {(x.inSource === "manual" || x.outSource === "manual") && <span className="ml-0.5 text-muted-foreground">(補)</span>}
                        </span>
                      ))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{d.workedMinutes > 0 ? h(d.workedMinutes) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{d.regularMinutes > 0 ? h(d.regularMinutes) : "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">
                  {d.otSegments.map((o) => `${h(o.minutes)}h×${o.multiplier}`).join(" + ")}
                  {d.holidayMinutes > 0 ? `${h(d.holidayMinutes)}h×${d.holidayMultiplier}` : ""}
                  {d.otSegments.length === 0 && d.holidayMinutes === 0 ? "—" : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[#92400E]">{d.lateMinutes || ""}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{d.earlyMinutes || ""}</td>
                <td className="px-3 py-2 text-xs">{d.leave ? `${LEAVE_TYPE_LABEL[d.leave.type]} ${d.leave.hours}h` : ""}</td>
                <td className="px-3 py-2 text-xs text-[#92400E]">{d.anomalies.map((a) => ANOMALY_LABEL[a.kind]).join("；")}</td>
              </tr>
            ))}
            {days.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">這個月沒有打卡、排班或請假</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
