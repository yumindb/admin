/**
 * 工時對帳 Excel(Phase C)。三張 sheet:彙總 / 每日明細 / 異常。
 * 只有時數與倍率,沒有金額(金額在 Phase D)。
 */
import * as XLSX from "xlsx";
import { LEAVE_TYPE_LABEL, ROLE_LABEL } from "@/lib/leave";
import type { LeaveType } from "@/lib/types";
import { DAY_TYPE_LABEL } from "@/lib/payroll/holidays";
import type { PersonWorkHours } from "@/lib/payroll/work-hours-data";
import { ANOMALY_LABEL, minutesToHoursLabel, taipeiTime } from "@/lib/payroll/work-hours";

const h = (m: number) => Number(minutesToHoursLabel(m));

export function buildWorkHoursXlsx(input: { rangeLabel: string; people: PersonWorkHours[] }): Buffer {
  const { rangeLabel, people } = input;
  const wb = XLSX.utils.book_new();

  // 彙總:各倍率欄位依實際出現的倍率動態產生
  const weekdayMultipliers = Array.from(new Set(people.flatMap((p) => p.summary.weekdayOt.map((o) => o.multiplier)))).sort();
  const restMultipliers = Array.from(new Set(people.flatMap((p) => p.summary.restDayOt.map((o) => o.multiplier)))).sort();
  const leaveTypes = Array.from(new Set(people.flatMap((p) => Object.keys(p.summary.leaveHours)))) as LeaveType[];

  const summary: (string | number)[][] = [
    ["工時對帳"],
    [`範圍：${rangeLabel}`],
    [],
    [
      "姓名",
      "角色",
      "排班天數",
      "出勤天數",
      "打卡總時數",
      "扣休息後時數",
      "正常工時",
      ...weekdayMultipliers.map((m) => `平日加班 ×${m}`),
      ...restMultipliers.map((m) => `休息日 ×${m}`),
      "假日出勤（×倍率）",
      "加班合計",
      "超過上限",
      "遲到次數",
      "遲到分鐘",
      "早退次數",
      "缺勤天數",
      ...leaveTypes.map((t) => `${LEAVE_TYPE_LABEL[t]}（小時）`),
      "異常筆數",
    ],
  ];
  for (const p of people) {
    const s = p.summary;
    summary.push([
      p.user.full_name,
      ROLE_LABEL[p.user.role as keyof typeof ROLE_LABEL] ?? p.user.role,
      s.scheduledDays,
      s.workedDays,
      h(s.rawMinutes),
      h(s.workedMinutes),
      h(s.regularMinutes),
      ...weekdayMultipliers.map((m) => h(s.weekdayOt.find((o) => o.multiplier === m)?.minutes ?? 0)),
      ...restMultipliers.map((m) => h(s.restDayOt.find((o) => o.multiplier === m)?.minutes ?? 0)),
      s.holidayMinutes > 0 ? `${h(s.holidayMinutes)}（×${s.holidayMultiplier}）` : 0,
      h(s.totalOtMinutes),
      s.otCapExceeded ? "是" : "",
      s.lateCount,
      s.lateMinutes,
      s.earlyCount,
      s.absentDays,
      ...leaveTypes.map((t) => s.leaveHours[t] ?? 0),
      s.anomalies.length,
    ]);
  }
  const ws1 = XLSX.utils.aoa_to_sheet(summary);
  ws1["!cols"] = summary[3].map((_, i) => ({ wch: i < 2 ? 12 : 11 }));
  XLSX.utils.book_append_sheet(wb, ws1, "彙總");

  // 每日明細:只列有內容的日子(有打卡 / 有排班 / 有請假 / 有異常)
  const detail: (string | number)[][] = [
    ["日期", "姓名", "日型別", "排班", "打卡", "扣休息後", "正常", "加班分段", "假日出勤", "遲到", "早退", "請假", "異常"],
  ];
  for (const p of people) {
    for (const d of p.days) {
      if (d.sessions.length === 0 && !d.scheduled && !d.leave && d.anomalies.length === 0) continue;
      detail.push([
        d.date,
        p.user.full_name,
        DAY_TYPE_LABEL[d.dayType],
        d.scheduled ? `${d.scheduled.start}–${d.scheduled.end}` : "",
        d.sessions.map((s) => `${taipeiTime(s.inAt)}–${s.outAt ? taipeiTime(s.outAt) : "？"}`).join("、"),
        h(d.workedMinutes),
        h(d.regularMinutes),
        d.otSegments.map((o) => `${h(o.minutes)}h×${o.multiplier}`).join(" + "),
        d.holidayMinutes > 0 ? `${h(d.holidayMinutes)}h×${d.holidayMultiplier}` : "",
        d.lateMinutes || "",
        d.earlyMinutes || "",
        d.leave ? `${LEAVE_TYPE_LABEL[d.leave.type]} ${d.leave.hours}h` : "",
        d.anomalies.map((a) => ANOMALY_LABEL[a.kind]).join("；"),
      ]);
    }
  }
  const ws2 = XLSX.utils.aoa_to_sheet(detail);
  ws2["!cols"] = [12, 10, 8, 12, 22, 9, 8, 22, 12, 6, 6, 12, 28].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, "每日明細");

  const anomalies: (string | number)[][] = [["日期", "姓名", "類型", "說明"]];
  for (const p of people) {
    for (const a of p.summary.anomalies) {
      anomalies.push([a.date, p.user.full_name, ANOMALY_LABEL[a.kind], a.detail]);
    }
  }
  const ws3 = XLSX.utils.aoa_to_sheet(anomalies);
  ws3["!cols"] = [12, 10, 26, 50].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws3, "異常");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
