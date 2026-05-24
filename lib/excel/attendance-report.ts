/**
 * 出勤報表 Excel 產生器(migration-2.21)。
 * Server-side 跑;呼叫端把 attendance_events + 對應 user / case 名字 join 好餵進來。
 *
 * 單一 sheet:時間倒序的事件列表 + 距離 + 是否在範圍。
 */
import * as XLSX from "xlsx";

export type AttendanceReportRow = {
  created_at: string;       // ISO
  user_name: string;
  user_role: string;        // 中文 label
  case_label: string;       // "code｜name" or "（無案件）"
  event_type: "clock_in" | "clock_out";
  lat: number;
  lng: number;
  accuracy_m: number | null;
  distance_m: number | null;
  within_geofence: boolean | null;
  note: string | null;
};

const TPE_DATE = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Taipei",
});
const TPE_TIME = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
});

export function buildAttendanceReportXlsx(input: {
  rangeLabel: string;
  rows: AttendanceReportRow[];
}): Buffer {
  const { rangeLabel, rows } = input;

  const data: (string | number)[][] = [];
  data.push([`現場出勤報表`]);
  data.push([`範圍：${rangeLabel}`]);
  data.push([`筆數：${rows.length}`]);
  data.push([]);
  data.push([
    "日期",
    "時間",
    "姓名",
    "角色",
    "案件",
    "上/下班",
    "緯度",
    "經度",
    "精度（m）",
    "距工地（m）",
    "在範圍",
    "備註",
  ]);

  for (const r of rows) {
    const d = new Date(r.created_at);
    data.push([
      TPE_DATE.format(d),
      TPE_TIME.format(d),
      r.user_name,
      r.user_role,
      r.case_label,
      r.event_type === "clock_in" ? "上班" : "下班",
      r.lat,
      r.lng,
      r.accuracy_m ?? "",
      r.distance_m === null ? "" : Math.round(r.distance_m),
      r.within_geofence === null ? "—" : r.within_geofence ? "✓" : "超出",
      r.note ?? "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 32 },
    { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 30 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "出勤紀錄");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf;
}
